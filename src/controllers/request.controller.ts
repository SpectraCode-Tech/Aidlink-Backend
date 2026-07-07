import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { google } from "@ai-sdk/google";
import { generateText, Output, stepCountIs } from "ai";
import { z } from "zod";

// ==========================================
// AI DOCUMENT VERIFICATION SCHEMA
// ==========================================

const DocumentVerificationSchema = z.object({
  isValidInvoice: z
    .boolean()
    .describe(
      "True if document structure safely represents an official institutional invoice or school receipt.",
    ),
  extractedAmount: z
    .number()
    .describe(
      "The absolute total monetary value written clearly on the face of the invoice document.",
    ),
  calculatedTrustScore: z
    .number()
    .min(0)
    .max(100)
    .describe(
      "Algorithmic authenticity evaluation score matching structural validation points.",
    ),
  reasoningSummary: z
    .string()
    .describe(
      "Linguistic and structural logic context behind the assigned trust values.",
    ),
});

// ==========================================
// CONTROLLER ACTIONS
// ==========================================

/**
 * POST /requests
 * Beneficiary submits an aid campaign with an invoice.
 */
export const createAidRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { title, category, targetAmount, invoiceUrl, institutionName } =
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
      return res.status(404).json({
        error: "NotFound",
        message:
          "Beneficiary identification profile trace context missing or unavailable.",
      });
    }

    const imageResponse = await fetch(invoiceUrl);
    if (!imageResponse.ok) {
      return res.status(400).json({
        error: "AssetFetchError",
        message:
          "Failed to download validation asset from remote cloud storage link.",
      });
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const aiResult = await generateText({
      model: google("gemini-2.5-flash"),
      output: Output.object({ schema: DocumentVerificationSchema }),
      temperature: 0.1,
      stopWhen: stepCountIs(1),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this verification document invoice. Validate structural compliance for targeting vendor: "${institutionName}". Assign trust points dynamically based on metadata patterns.`,
            },
            {
              type: "image",
              image: base64Image,
            },
          ],
        },
      ],
    });

    const verificationResult = aiResult.experimental_output;

    let evaluationStatus: "APPROVED" | "PARTIAL_FUNDING_ALLOWED" | "REJECTED" =
      "REJECTED";
    const finalScore = verificationResult.calculatedTrustScore;

    if (verificationResult.isValidInvoice && finalScore >= 80) {
      evaluationStatus = "APPROVED";
    } else if (verificationResult.isValidInvoice && finalScore >= 60) {
      evaluationStatus = "PARTIAL_FUNDING_ALLOWED";
    }

    const savedRequest = await prisma.request.create({
      data: {
        beneficiaryId: beneficiary.id,
        title,
        category,
        targetAmount: Number(targetAmount),
        documentUrl: invoiceUrl,
        trustScore: finalScore,
        status: evaluationStatus,
      },
    });

    return res.status(201).json({
      message: "Request processed, categorized, and recorded successfully.",
      request: savedRequest,
      aiAnalysisSummary: verificationResult.reasoningSummary,
    });
  } catch (error: any) {
    return next(error);
  }
};

/**
 * GET /requests
 * Public — returns all aid requests with optional filters and pagination.
 */
export const getAllRequests = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const { status, category } = req.query;

    const pageRaw = typeof req.query.page === "string" ? req.query.page : "1";
    const limitRaw =
      typeof req.query.limit === "string" ? req.query.limit : "20";
    const page = Math.max(1, parseInt(pageRaw, 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw, 10)));
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status: status as any }),
      ...(category && { category: String(category) }),
    };

    const [requests, total] = await Promise.all([
      prisma.request.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          beneficiary: {
            select: {
              user: { select: { email: true } },
            },
          },
        },
      }),
      prisma.request.count({ where }),
    ]);

    return res.status(200).json({
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      count: requests.length,
      requests,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /requests/:id
 * Public — returns a single aid request with transactions and fulfillments.
 */
export const getRequestById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : undefined;

    if (!id) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Invalid target identifier parameter.",
      });
    }

    const requestItem = await prisma.request.findUnique({
      where: { id },
      include: {
        transactions: true,
        fulfillmentRequests: true,
      },
    });

    if (!requestItem) {
      return res.status(404).json({
        error: "NotFound",
        message: "Target aid request not found.",
      });
    }

    return res.status(200).json({ request: requestItem });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /requests/dashboard/me
 * Beneficiary dashboard — returns a summary of the authenticated beneficiary's
 * campaigns, balances, recent transactions, and fulfillment activity.
 */
export const getBeneficiaryDashboard = async (
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

    const beneficiary = await prisma.beneficiary.findUnique({
      where: { userId },
    });

    if (!beneficiary) {
      return res.status(404).json({
        error: "NotFound",
        message: "Beneficiary profile not found.",
      });
    }

    // Fetch all campaigns for this beneficiary
    const allCampaigns = await prisma.request.findMany({
      where: { beneficiaryId: beneficiary.id },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
        },
        fulfillmentRequests: {
          select: {
            id: true,
            status: true,
            payoutSettled: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Active campaigns — APPROVED or PARTIAL_FUNDING_ALLOWED and not yet fully delivered
    const activeCampaigns = allCampaigns.filter(
      (r) => r.status === "APPROVED" || r.status === "PARTIAL_FUNDING_ALLOWED",
    );

    // Total funds raised across all campaigns
    const totalFundsRaised = allCampaigns.reduce((sum, r) => {
      return sum + parseFloat(r.raisedAmount.toString());
    }, 0);

    // Total funds still needed (target - raised) across active campaigns
    const totalFundsNeeded = activeCampaigns.reduce((sum, r) => {
      const needed =
        parseFloat(r.targetAmount.toString()) -
        parseFloat(r.raisedAmount.toString());
      return sum + Math.max(0, needed);
    }, 0);

    // Recent transactions across all campaigns (last 10)
    const recentTransactions = allCampaigns
      .flatMap((r) =>
        r.transactions.map((t) => ({
          ...t,
          campaignTitle: r.title,
          campaignId: r.id,
        })),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);

    // Campaign breakdown by status
    const campaignStats = {
      total: allCampaigns.length,
      approved: allCampaigns.filter((r) => r.status === "APPROVED").length,
      partialFunding: allCampaigns.filter(
        (r) => r.status === "PARTIAL_FUNDING_ALLOWED",
      ).length,
      rejected: allCampaigns.filter((r) => r.status === "REJECTED").length,
      pendingAI: allCampaigns.filter((r) => r.status === "PENDING_AI").length,
    };

    // KYC status
    const kycStatus = {
      ninVerified: beneficiary.ninStatus === "VERIFIED",
      faceVerified: beneficiary.faceMatchStatus === "VERIFIED",
      fullyVerified:
        beneficiary.ninStatus === "VERIFIED" &&
        beneficiary.faceMatchStatus === "VERIFIED",
    };

    return res.status(200).json({
      dashboard: {
        kycStatus,
        summary: {
          totalFundsRaised,
          totalFundsNeeded,
          totalCampaigns: allCampaigns.length,
          activeCampaigns: activeCampaigns.length,
        },
        campaignStats,
        activeCampaigns: activeCampaigns.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          targetAmount: r.targetAmount,
          raisedAmount: r.raisedAmount,
          percentageFunded:
            Math.min(
              100,
              Math.round(
                (parseFloat(r.raisedAmount.toString()) /
                  parseFloat(r.targetAmount.toString())) *
                  100,
              ),
            ) + "%",
          status: r.status,
          trustScore: r.trustScore,
          createdAt: r.createdAt,
          fulfillmentStatus:
            r.fulfillmentRequests[0]?.status ?? "NO_FULFILLMENT",
          payoutSettled: r.fulfillmentRequests[0]?.payoutSettled ?? false,
        })),
        recentTransactions,
        allCampaigns: allCampaigns.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          targetAmount: r.targetAmount,
          raisedAmount: r.raisedAmount,
          status: r.status,
          trustScore: r.trustScore,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
};
