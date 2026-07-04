import { Request, Response, NextFunction } from "express";
import { prisma } from "../middleware/auth.js";
import crypto from "crypto";

/**
 * Verifies the HMAC-SHA256 signature sent by Nomba in the nomba-signature header.
 *
 * IMPORTANT — Nomba's signature is computed over the RAW request body bytes,
 * not over a reconstructed JSON string. The rawBody must be captured before
 * express.json() parses the request (handled in webhook.routes.ts).
 *
 * Encoding: Base64 (not hex)
 * Algorithm: HMAC-SHA256
 * Key: NOMBA_SIGNING_SECRET from your webhook dashboard config
 *      (hackathon key: "NombaHackathon2026")
 */
const verifyNombaSignature = (req: Request): boolean => {
  const incomingSignature = req.headers["nomba-signature"];
  if (!incomingSignature) return false;

  const signingSecret = process.env.NOMBA_SIGNING_SECRET;
  if (!signingSecret) return false;

  // rawBody is the untouched byte string captured in webhook.routes.ts
  // before express.json() mutates the payload
  const rawPayload = (req as any).rawBody;
  if (!rawPayload) return false;

  // Nomba signs with HMAC-SHA256 and encodes as Base64
  const computedHash = crypto
    .createHmac("sha256", signingSecret)
    .update(rawPayload)
    .digest("base64");

  const incoming = Array.isArray(incomingSignature)
    ? incomingSignature[0]!
    : incomingSignature;

  // Timing-safe comparison prevents side-channel attacks
  const incomingBuffer = Buffer.from(incoming);
  const computedBuffer = Buffer.from(computedHash);

  if (incomingBuffer.length !== computedBuffer.length) return false;
  return crypto.timingSafeEqual(incomingBuffer, computedBuffer);
};

/**
 * POST /webhooks/payments/nomba-webhook
 *
 * Receives Nomba payment_success events, credits the aid campaign,
 * and auto-spawns a fulfillment dispatch when the funding target is met.
 *
 * Actual webhook payload structure (from Nomba docs):
 * {
 *   "event_type": "payment_success",
 *   "requestId": "uuid",
 *   "data": {
 *     "transaction": {
 *       "transactionId": "WEB-ONLINE_C-...",
 *       "type": "online_checkout",
 *       "transactionAmount": 2400.0,
 *       "fee": 93.6,
 *       "time": "2024-01-11T16:33:04Z"
 *     },
 *     "order": {
 *       "orderReference": "AL-TX-...",
 *       "amount": 2400.0,
 *       "currency": "NGN",
 *       "paymentMethod": "card_payment"
 *     }
 *   }
 * }
 *
 * Our requestId lives in orderMetaData (set during checkout creation).
 * Nomba mirrors it back inside data.order.orderMetaData.requestId
 */
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

    // Only process successful payment events
    if (event_type !== "payment_success") {
      return res.status(200).json({
        received: true,
        message: "Event type ignored.",
      });
    }

    // Extract fields from actual Nomba payload structure
    const orderReference = data?.order?.orderReference as string | undefined;
    const amountPaid = data?.order?.amount as number | undefined;
    const donorEmail = data?.customer?.senderName ?? null;

    // requestId is the value we packed into orderMetaData during checkout
    // Nomba mirrors it back at data.order.orderMetaData.requestId
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
      // IDEMPOTENCY GUARD: ignore duplicate webhook deliveries
      // Nomba retries 5 times on non-2xx — this prevents double-crediting
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

      // 1. Update existing pending transaction to SUCCESS
      //    (created when donor initiated checkout in initializeDonation)
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

      // 2. Increment the campaign's raisedAmount
      const currentRaised = parseFloat(crowdRequest.raisedAmount.toString());
      const newRaisedAmount = currentRaised + amountPaid;

      await tx.request.update({
        where: { id: targetRequestId },
        data: { raisedAmount: newRaisedAmount },
      });

      // 3. If target met, auto-create a fulfillment dispatch
      const targetGoal = parseFloat(crowdRequest.targetAmount.toString());
      if (newRaisedAmount >= targetGoal && crowdRequest.status !== "APPROVED") {
        await tx.request.update({
          where: { id: targetRequestId },
          data: { status: "APPROVED" },
        });

        const secureCode = crypto.randomBytes(3).toString("hex").toUpperCase();

        const beneficiaryEmail = crowdRequest.beneficiary.user.email;

        await tx.fulfillmentRequest.create({
          data: {
            beneficiaryId: crowdRequest.beneficiaryId,
            requestId: crowdRequest.id,
            title: `Fulfillment for: ${crowdRequest.title}`,
            description: `Auto-created on crowdfunding completion. Ref: ${orderReference}`,
            // TODO: Replace with stored delivery address once added to profile
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
    });

    // Always return 200 quickly — Nomba retries on non-2xx
    return res.status(200).json({
      status: "SUCCESS",
      message: "Webhook received and processed.",
    });
  } catch (error: any) {
    if (error.message === "REQUEST_NOT_FOUND") {
      // Still return 200 to stop Nomba retrying — we just log it
      return res.status(200).json({
        status: "IGNORED",
        message: "Target request not found.",
      });
    }
    return next(error);
  }
};
