import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { triggerPartnerPayout } from "../helpers/nomba-transfer.ts";
import crypto from "crypto";
import { z } from "zod";

// ==========================================
// CENTRALIZED STRUCTURAL ROUTE SCHEMAS
// ==========================================

export const CreateRequestSchema = z.object({
  body: z.object({
    title: z.string().min(3, "Title must be descriptive."),
    description: z.string().optional(),
    deliveryAddress: z.string().min(5, "Full delivery address is required."),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
});

export const UpdateStatusSchema = z.object({
  body: z.object({
    status: z.enum(["IN_TRANSIT", "ARRIVED", "CANCELLED"]),
    notes: z.string().optional(),
  }),
});

export const CompleteFulfillmentSchema = z.object({
  body: z.object({
    verificationCode: z
      .string()
      .length(6, "Verification token must be exactly 6 characters."),
  }),
});

export const FeedQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().default("1"),
    limit: z.string().optional().default("10"),
  }),
});

// ==========================================
// HELPERS
// ==========================================

const generateSecureToken = (): string => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

// ==========================================
// CONTROLLER ACTIONS
// ==========================================

/**
 * POST /logistics/requests
 * Beneficiary creates a new fulfillment request (requires KYC verified).
 */
export const createRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { title, description, deliveryAddress, latitude, longitude } =
      req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "User context missing." });
    }

    const beneficiary = await prisma.beneficiary.findUnique({
      where: { userId },
    });

    if (!beneficiary) {
      return res
        .status(404)
        .json({ error: "NotFound", message: "Beneficiary profile not found." });
    }

    if (
      beneficiary.ninStatus !== "VERIFIED" ||
      beneficiary.faceMatchStatus !== "VERIFIED"
    ) {
      return res.status(403).json({
        error: "Forbidden",
        message:
          "Account KYC requirements must be verified before requesting logistics fulfillment.",
      });
    }

    const verificationCode = generateSecureToken();

    const request = await prisma.fulfillmentRequest.create({
      data: {
        beneficiaryId: beneficiary.id,
        title,
        description: description ?? null,
        deliveryAddress,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        verificationCode,
        logs: {
          create: {
            status: "PENDING",
            changedBy: userId,
            notes: "Fulfillment request initialized.",
          },
        },
      },
    });

    return res.status(201).json({
      message: "Fulfillment request created successfully.",
      requestId: request.id,
      status: request.status,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * PATCH /logistics/requests/:requestId/claim
 * Partner claims a PENDING fulfillment job (atomic — prevents race conditions).
 */
export const claimRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const requestId =
      typeof req.params.requestId === "string"
        ? req.params.requestId
        : undefined;
    const userId = req.user?.id;

    if (!requestId || !userId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid request ID or missing user context.",
      });
    }

    const partner = await prisma.fulfillmentPartner.findUnique({
      where: { userId },
    });

    if (!partner) {
      return res.status(404).json({
        error: "NotFound",
        message: "Fulfillment partner profile not found.",
      });
    }

    if (partner.cacStatus !== "VERIFIED") {
      return res.status(403).json({
        error: "Forbidden",
        message:
          "Your corporate CAC status must be verified to claim deliveries.",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const targetRequest = await tx.fulfillmentRequest.findUnique({
        where: { id: requestId },
      });

      if (!targetRequest) throw new Error("NOT_FOUND");
      if (targetRequest.status !== "PENDING")
        throw new Error("ALREADY_CLAIMED");

      return tx.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          partnerId: partner.id,
          status: "ASSIGNED",
          logs: {
            create: {
              status: "ASSIGNED",
              changedBy: userId,
              notes: `Claimed by partner: ${partner.id}`,
            },
          },
        },
      });
    });

    return res.status(200).json({
      message: "Logistics package assigned successfully.",
      status: result.status,
    });
  } catch (error: any) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({
        error: "NotFound",
        message: "Logistics request does not exist.",
      });
    }
    if (error.message === "ALREADY_CLAIMED") {
      return res.status(409).json({
        error: "Conflict",
        message: "This assignment has already been claimed.",
      });
    }
    return next(error);
  }
};

/**
 * PATCH /logistics/requests/:requestId/status
 * Partner updates the shipment status (IN_TRANSIT / ARRIVED / CANCELLED).
 */
export const updateRequestStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const requestId =
      typeof req.params.requestId === "string"
        ? req.params.requestId
        : undefined;
    const userId = req.user?.id;

    if (!requestId || !userId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid request ID or missing user context.",
      });
    }

    const { status, notes } = req.body;

    const [partner, targetRequest] = await Promise.all([
      prisma.fulfillmentPartner.findUnique({ where: { userId } }),
      prisma.fulfillmentRequest.findUnique({ where: { id: requestId } }),
    ]);

    if (!targetRequest || !partner || targetRequest.partnerId !== partner.id) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Not authorized to modify this fulfillment record.",
      });
    }

    if (
      targetRequest.status === "COMPLETED" ||
      targetRequest.status === "CANCELLED"
    ) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Cannot change status of a terminal fulfillment.",
      });
    }

    const updated = await prisma.fulfillmentRequest.update({
      where: { id: requestId },
      data: {
        status,
        logs: {
          create: {
            status,
            changedBy: userId,
            notes: notes ?? `Status updated to ${status}`,
          },
        },
      },
    });

    return res.status(200).json({
      message: `Tracking state advanced to ${status}.`,
      status: updated.status,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /logistics/requests/:requestId/complete
 *
 * Partner submits the 6-digit code obtained physically from the beneficiary.
 * On match: marks COMPLETED, triggers Nomba v2 bank transfer to partner NUBAN.
 *
 * Returns "SUCCESS" immediately if Nomba confirms (200).
 * Returns "PENDING" if Nomba is still processing (201) — payout_success webhook settles it.
 * Returns payoutSettled: false if transfer fails — admin can retry.
 */
export const completeFulfillment = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const requestId =
      typeof req.params.requestId === "string"
        ? req.params.requestId
        : undefined;
    const userId = req.user?.id;

    if (!requestId || !userId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid request ID or missing user context.",
      });
    }

    const { verificationCode } = req.body;

    const [partner, targetRequest] = await Promise.all([
      prisma.fulfillmentPartner.findUnique({ where: { userId } }),
      prisma.fulfillmentRequest.findUnique({ where: { id: requestId } }),
    ]);

    if (!targetRequest || !partner || targetRequest.partnerId !== partner.id) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Access authorization denied.",
      });
    }

    if (
      targetRequest.verificationCode !== verificationCode.trim().toUpperCase()
    ) {
      return res.status(422).json({
        status: "INVALID_TOKEN",
        message: "Verification code mismatch. Delivery cannot be confirmed.",
      });
    }

    // Step 1: Mark COMPLETED — payoutSettled stays false until transfer confirms
    await prisma.fulfillmentRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        payoutSettled: false,
        logs: {
          create: {
            status: "COMPLETED",
            changedBy: userId,
            notes: "Secure handshake verified. Initiating payout transfer.",
          },
        },
      },
    });

    // Step 2: Trigger Nomba v2 bank transfer
    // Returns "SUCCESS" (200) or "PENDING" (201 — final result via payout_success webhook)
    try {
      const payoutStatus = await triggerPartnerPayout(partner.id, requestId);

      if (payoutStatus === "SUCCESS") {
        await prisma.fulfillmentRequest.update({
          where: { id: requestId },
          data: {
            payoutSettled: true,
            logs: {
              create: {
                status: "COMPLETED",
                changedBy: "SYSTEM_NOMBA_PAYOUT",
                notes: "Nomba transfer confirmed immediately (200).",
              },
            },
          },
        });

        return res.status(200).json({
          status: "COMPLETED",
          payoutSettled: true,
          message:
            "Delivery confirmed and partner payout transferred successfully.",
        });
      }

      // PENDING (201): Nomba is still processing
      await prisma.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: "SYSTEM_NOMBA_PAYOUT",
              notes:
                "Nomba transfer pending (201). Awaiting payout_success webhook.",
            },
          },
        },
      });

      return res.status(200).json({
        status: "COMPLETED",
        payoutSettled: false,
        message: "Delivery confirmed. Payout is being processed by Nomba.",
      });
    } catch (payoutError: any) {
      await prisma.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: "SYSTEM_NOMBA_PAYOUT",
              notes: `Payout failed: ${payoutError.message}. Admin retry required.`,
            },
          },
        },
      });

      return res.status(200).json({
        status: "COMPLETED",
        payoutSettled: false,
        message:
          "Delivery confirmed. Payout transfer failed — admin notified to retry.",
        payoutError: payoutError.message,
      });
    }
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /logistics/feed
 * Partner fetches available (PENDING) jobs with pagination.
 */
export const getAvailableJobsFeed = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized", message: "User context missing." });
    }

    const pageRaw = typeof req.query.page === "string" ? req.query.page : "1";
    const limitRaw =
      typeof req.query.limit === "string" ? req.query.limit : "10";
    const pageNum = Math.max(1, parseInt(pageRaw, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limitRaw, 10)));
    const skip = (pageNum - 1) * limitNum;

    const partner = await prisma.fulfillmentPartner.findUnique({
      where: { userId },
    });

    if (!partner) {
      return res.status(404).json({
        error: "NotFound",
        message: "Fulfillment partner profile not found.",
      });
    }

    if (partner.cacStatus !== "VERIFIED") {
      return res.status(403).json({
        error: "Forbidden",
        message:
          "Your CAC status must be verified to access the logistics job pool.",
      });
    }

    const [openJobs, totalJobsCount] = await Promise.all([
      prisma.fulfillmentRequest.findMany({
        where: { status: "PENDING" },
        select: {
          id: true,
          title: true,
          description: true,
          deliveryAddress: true,
          latitude: true,
          longitude: true,
          createdAt: true,
          // verificationCode intentionally excluded from feed
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.fulfillmentRequest.count({ where: { status: "PENDING" } }),
    ]);

    return res.status(200).json({
      meta: {
        totalJobsCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalJobsCount / limitNum),
        hasNextPage: skip + openJobs.length < totalJobsCount,
      },
      jobs: openJobs,
    });
  } catch (error) {
    return next(error);
  }
};
