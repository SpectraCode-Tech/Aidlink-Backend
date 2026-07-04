import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { triggerPartnerPayout } from "../helpers/nomba-transfer.js";
import { z } from "zod";

export const OverrideFulfillmentSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .min(5, "An explicit audit reason is required for manual overrides."),
  }),
});

// ==========================================
// CONTROLLER ACTIONS
// ==========================================

/**
 * GET /admin/metrics
 */
export const getSystemMetrics = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const [totalBeneficiaries, totalPartners, totalRequests, activePasses] =
      await Promise.all([
        prisma.user.count({ where: { role: "BENEFICIARY" } }),
        prisma.user.count({ where: { role: "PARTNER" } }),
        prisma.fulfillmentRequest.count(),
        prisma.accessPass.count({ where: { status: "ACTIVE" } }),
      ]);

    const statusCounts = await prisma.fulfillmentRequest.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const unsettledPayouts = await prisma.fulfillmentRequest.count({
      where: { status: "COMPLETED", payoutSettled: false },
    });

    return res.status(200).json({
      summary: {
        totalBeneficiaries,
        totalPartners,
        totalRequests,
        activePasses,
        unsettledPayouts,
      },
      logisticsBreakdown: statusCounts.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /admin/audit-failures
 */
export const getAuditLogs = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const deniedSecurityLogs = await prisma.securityAccessLog.findMany({
      where: { action: { in: ["DENIED_EXPIRED", "DENIED_REUSED"] } },
      include: { accessPass: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({ logs: deniedSecurityLogs });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /admin/requests/:requestId/override
 *
 * Forces a stuck fulfillment to COMPLETED and triggers Nomba payout.
 * Handles both immediate (200) and pending (201) transfer responses.
 */
export const manualOverrideFulfillment = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const requestId =
      typeof req.params.requestId === "string"
        ? req.params.requestId
        : undefined;

    if (!requestId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "A valid fulfillment request ID must be specified.",
      });
    }

    const adminId = req.user?.id;
    if (!adminId) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Admin user context missing.",
      });
    }

    const { reason } = req.body;

    const targetRequest = await prisma.fulfillmentRequest.findUnique({
      where: { id: requestId },
    });

    if (!targetRequest) {
      return res.status(404).json({
        error: "NotFound",
        message: "Target logistics record missing.",
      });
    }

    if (
      targetRequest.status === "COMPLETED" ||
      targetRequest.status === "CANCELLED"
    ) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Cannot override a terminal transaction state.",
      });
    }

    // Step 1: Force COMPLETED
    await prisma.fulfillmentRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        payoutSettled: false,
        logs: {
          create: {
            status: "COMPLETED",
            changedBy: adminId,
            notes: `[ADMIN OVERRIDE] Reason: ${reason}`,
          },
        },
      },
    });

    // Step 2: Skip payout if no partner was assigned
    if (!targetRequest.partnerId) {
      return res.status(200).json({
        message: "Override applied. No partner was assigned — payout skipped.",
        status: "COMPLETED",
        payoutSettled: false,
      });
    }

    // Step 3: Attempt payout
    try {
      const payoutStatus = await triggerPartnerPayout(
        targetRequest.partnerId,
        requestId,
      );

      if (payoutStatus === "SUCCESS") {
        await prisma.fulfillmentRequest.update({
          where: { id: requestId },
          data: {
            payoutSettled: true,
            logs: {
              create: {
                status: "COMPLETED",
                changedBy: "SYSTEM_NOMBA_PAYOUT",
                notes: "Admin override payout confirmed by Nomba (200).",
              },
            },
          },
        });

        return res.status(200).json({
          message:
            "Override applied and partner payout transferred successfully.",
          status: "COMPLETED",
          payoutSettled: true,
        });
      }

      // PENDING (201)
      await prisma.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: "SYSTEM_NOMBA_PAYOUT",
              notes:
                "Admin override payout pending (201). Awaiting payout_success webhook.",
            },
          },
        },
      });

      return res.status(200).json({
        message: "Override applied. Payout is being processed by Nomba.",
        status: "COMPLETED",
        payoutSettled: false,
      });
    } catch (payoutError: any) {
      await prisma.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: "SYSTEM_NOMBA_PAYOUT",
              notes: `Admin override payout failed: ${payoutError.message}. Manual retry required.`,
            },
          },
        },
      });

      return res.status(200).json({
        message:
          "Override applied. Payout transfer failed — manual retry required.",
        status: "COMPLETED",
        payoutSettled: false,
        payoutError: payoutError.message,
      });
    }
  } catch (error) {
    return next(error);
  }
};
