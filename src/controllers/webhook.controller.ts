import { Request, Response, NextFunction } from "express";
import { prisma } from "../middleware/auth.js";
import crypto from "crypto";

const verifyNombaSignature = (req: Request): boolean => {
  const incomingSignature = req.headers["nomba-signature"];
  if (!incomingSignature) return false;

  const signingSecret = process.env.NOMBA_SIGNING_SECRET;
  if (!signingSecret) return false;

  const rawPayload = (req as any).rawBody;
  if (!rawPayload) return false;

  const computedHash = crypto
    .createHmac("sha256", signingSecret)
    .update(rawPayload)
    .digest("base64");

  const incoming = Array.isArray(incomingSignature)
    ? incomingSignature[0]!
    : incomingSignature;

  const incomingBuffer = Buffer.from(incoming);
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
        message: "Invalid webhook signature.",
      });
    }

    const { event_type, data } = req.body;

    if (event_type !== "payment_success") {
      return res.status(200).json({
        received: true,
        message: "Event type ignored.",
      });
    }

    const orderReference = data?.order?.orderReference as string | undefined;
    const amountPaid = data?.order?.amount as number | undefined;
    const donorEmail = data?.customer?.senderName ?? null;
    const targetRequestId = data?.order?.orderMetaData?.requestId as
      | string
      | undefined;

    if (!orderReference || !amountPaid || !targetRequestId) {
      return res.status(400).json({
        error: "BadRequest",
        message: "Missing required fields in webhook payload.",
      });
    }

    await prisma.$transaction(async (tx) => {
      // IDEMPOTENCY: skip if already processed
      const existingTx = await tx.transaction.findUnique({
        where: { reference: orderReference },
      });
      if (existingTx && existingTx.status === "SUCCESS") return;

      const crowdRequest = await tx.request.findUnique({
        where: { id: targetRequestId },
        include: {
          beneficiary: {
            include: { user: true },
          },
        },
      });
      if (!crowdRequest) throw new Error("REQUEST_NOT_FOUND");

      // 1. Mark transaction as SUCCESS
      await tx.transaction.upsert({
        where: { reference: orderReference },
        update: { status: "SUCCESS" },
        create: {
          requestId: targetRequestId,
          amount: amountPaid,
          reference: orderReference,
          status: "SUCCESS",
          donorEmail: typeof donorEmail === "string" ? donorEmail : null,
        },
      });

      // 2. Increment raisedAmount
      const currentRaised = parseFloat(crowdRequest.raisedAmount.toString());
      const newRaisedAmount = currentRaised + amountPaid;

      await tx.request.update({
        where: { id: targetRequestId },
        data: { raisedAmount: newRaisedAmount },
      });

      // 3. If target met, create fulfillment dispatch
      const targetGoal = parseFloat(crowdRequest.targetAmount.toString());

      if (newRaisedAmount >= targetGoal) {
        // FIX: Query for existing fulfillment instead of accessing non-existent relation
        const existingFulfillment = await tx.fulfillmentRequest.findFirst({
          where: { requestId: crowdRequest.id },
        });

        if (!existingFulfillment) {
          await tx.request.update({
            where: { id: targetRequestId },
            data: { status: "APPROVED" },
          });

          const secureCode = crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

          const beneficiaryEmail = crowdRequest.beneficiary.user.email;

          await tx.fulfillmentRequest.create({
            data: {
              beneficiaryId: crowdRequest.beneficiaryId,
              requestId: crowdRequest.id,
              title: `Fulfillment for: ${crowdRequest.title}`,
              description: `Auto-created on crowdfunding completion. Ref: ${orderReference}`,
              deliveryAddress: `Contact beneficiary: ${beneficiaryEmail}`,
              verificationCode: secureCode,
              status: "PENDING",
              logs: {
                create: {
                  status: "PENDING",
                  changedBy: "SYSTEM_NOMBA_WEBHOOK",
                  notes:
                    "Crowdfunding target reached. Distribution engine initiated.",
                },
              },
            },
          });
        }
      }
    });

    return res.status(200).json({
      status: "SUCCESS",
      message: "Webhook received and processed.",
    });
  } catch (error: any) {
    if (error.message === "REQUEST_NOT_FOUND") {
      return res.status(200).json({
        status: "IGNORED",
        message: "Target request not found.",
      });
    }
    return next(error);
  }
};
