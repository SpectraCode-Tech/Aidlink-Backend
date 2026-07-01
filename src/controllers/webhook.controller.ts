import { Request, Response, NextFunction } from "express";
import { prisma } from "../middleware/auth.js";
import crypto from "crypto";

const verifyNombaSignature = (req: Request): boolean => {
  const incomingSignature = req.headers["nomba-signature"];
  if (!incomingSignature) return false;

  const signingSecret = process.env.NOMBA_SIGNING_SECRET;
  if (!signingSecret) return false;

    const rawPayload = (req as any).rawBody || JSON.stringify(req.body);

  const computedHash = crypto
    .createHmac("sha256", signingSecret)
    .update(rawPayload)
    .digest("hex");

  const incomingBuffer = Buffer.from(
    Array.isArray(incomingSignature)
      ? incomingSignature[0]!
      : incomingSignature,
  );
  const computedBuffer = Buffer.from(computedHash);

  if (incomingBuffer.length !== computedBuffer.length) return false;

  return crypto.timingSafeEqual(incomingBuffer, computedBuffer);
};

export const handleNombaWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  try {
    if (!verifyNombaSignature(req)) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid webhook signature origin.",
      });
    }

    const { event_type, data } = req.body;

    if (event_type !== "payment_success") {
      return res
        .status(200)
        .json({ received: true, message: "Event type ignored." });
    }

    const orderReference = (data.orderReference || data.reference) as string;
    const amountPaid = parseFloat(data.amount);
    const donorEmail = (data.donorEmail || data.customer?.email || null) as
      | string
      | null;

        const targetRequestId = (data.orderMetaData?.requestId ||
      data.metadata?.requestId) as string | undefined;

    if (!targetRequestId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Missing target requestId in checkout metadata.",
      });
    }

    await prisma.$transaction(async (tx) => {
            const existingTx = await tx.transaction.findUnique({
        where: { reference: orderReference },
      });
      if (existingTx) return;

      const crowdRequest = await tx.request.findUnique({
        where: { id: targetRequestId },
        include: {
          beneficiary: {
            include: { user: true },
          },
        },
      });
      if (!crowdRequest) throw new Error("REQUEST_NOT_FOUND");

            await tx.transaction.create({
        data: {
          requestId: targetRequestId,
          amount: amountPaid,
          reference: orderReference,
          status: "SUCCESS",
          donorEmail,
        },
      });

            const currentRaised = parseFloat(crowdRequest.raisedAmount.toString());
      const newRaisedAmount = currentRaised + amountPaid;

      await tx.request.update({
        where: { id: targetRequestId },
        data: { raisedAmount: newRaisedAmount },
      });

            const targetGoal = parseFloat(crowdRequest.targetAmount.toString());
      if (newRaisedAmount >= targetGoal && crowdRequest.status !== "APPROVED") {
        await tx.request.update({
          where: { id: targetRequestId },
          data: { status: "APPROVED" },
        });

        const secureVerificationCode = crypto
          .randomBytes(3)
          .toString("hex")
          .toUpperCase();

                const beneficiaryEmail = crowdRequest.beneficiary.user.email;

        await tx.fulfillmentRequest.create({
          data: {
            beneficiaryId: crowdRequest.beneficiaryId,
            requestId: crowdRequest.id,
            title: `Fulfillment for: ${crowdRequest.title}`,
            description: `Automated logistics release via crowdfunding completion. Reference: ${orderReference}`,
                        deliveryAddress: `Contact beneficiary: ${beneficiaryEmail}`,
            verificationCode: secureVerificationCode,
            status: "PENDING",
            logs: {
              create: {
                status: "PENDING",
                changedBy: "SYSTEM_NOMBA_WEBHOOK",
                notes:
                  "Crowdfunding target reached. Distribution engine initiated automatically.",
              },
            },
          },
        });
      }
    });

    return res.status(200).json({
      status: "SUCCESS",
      message: "Webhook settlement mapped cleanly.",
    });
  } catch (error: any) {
    if (error.message === "REQUEST_NOT_FOUND") {
      return res.status(404).json({
        error: "NotFound",
        message: "Target aid request not found.",
      });
    }
    return next(error);
  }
};
