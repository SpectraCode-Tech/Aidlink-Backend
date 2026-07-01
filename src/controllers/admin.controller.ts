import { Response, NextFunction } from "express";
import { AuthenticatedRequest, prisma } from "../middleware/auth.js";
import { getNombaAccessToken } from "./payments.controller.js";
import axios from "axios";
import { z } from "zod";

export const OverrideFulfillmentSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .min(5, "An explicit audit reason is required for manual overrides."),
  }),
});


const triggerPartnerPayout = async (
  partnerId: string | null,
  fulfillmentRequestId: string,
): Promise<string> => {
  if (!partnerId) throw new Error("PARTNER_NOT_ASSIGNED");

  const [partner, fulfillment] = await Promise.all([
    prisma.fulfillmentPartner.findUnique({ where: { id: partnerId } }),
    prisma.fulfillmentRequest.findUnique({
      where: { id: fulfillmentRequestId },
      include: { request: true },
    }),
  ]);

  if (!partner) throw new Error("PARTNER_NOT_FOUND");
  if (!fulfillment) throw new Error("FULFILLMENT_NOT_FOUND");

  if (!partner.bankAccount || !partner.bankCode || !partner.bankAccountName) {
    throw new Error("PARTNER_BANK_DETAILS_MISSING");
  }

  const payoutAmountNaira = fulfillment.request
    ? parseFloat(fulfillment.request.targetAmount.toString())
    : 0;

  if (payoutAmountNaira <= 0) throw new Error("INVALID_PAYOUT_AMOUNT");

    let merchantTxRef = fulfillment.payoutReference;
  if (!merchantTxRef) {
    merchantTxRef = `AL-ADMIN-PAYOUT-${fulfillmentRequestId}-${Date.now()}`;
    await prisma.fulfillmentRequest.update({
      where: { id: fulfillmentRequestId },
      data: { payoutReference: merchantTxRef },
    });
  }

  const accessToken = await getNombaAccessToken();

    await axios.post(
    `${process.env.NOMBA_BASE_URL}/v2/transfers/bank`,
    {
      amount: payoutAmountNaira,
      accountNumber: partner.bankAccount,
      accountName: partner.bankAccountName,
      bankCode: partner.bankCode,
      merchantTxRef,
      senderName: "AidLink",
      narration: `Admin override payout — Fulfillment ID: ${fulfillmentRequestId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accountId: process.env.NOMBA_ACCOUNT_ID,
      },
    },
  );

  return merchantTxRef;
};


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

export const getAuditLogs = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    const deniedSecurityLogs = await prisma.securityAccessLog.findMany({
      where: {
        action: { in: ["DENIED_EXPIRED", "DENIED_REUSED"] },
      },
      include: { accessPass: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.status(200).json({ logs: deniedSecurityLogs });
  } catch (error) {
    return next(error);
  }
};

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

        if (!targetRequest.partnerId) {
      return res.status(200).json({
        message: "Override applied. No partner was assigned — payout skipped.",
        status: "COMPLETED",
        payoutSettled: false,
      });
    }

        try {
      const merchantTxRef = await triggerPartnerPayout(
        targetRequest.partnerId,
        requestId,
      );

      await prisma.fulfillmentRequest.update({
        where: { id: requestId },
        data: {
          payoutSettled: true,
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: "SYSTEM_NOMBA_PAYOUT",
              notes: `Admin override payout confirmed. Ref: ${merchantTxRef}`,
            },
          },
        },
      });

      return res.status(200).json({
        message:
          "Administrative override applied and partner payout transferred successfully.",
        status: "COMPLETED",
        payoutSettled: true,
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
