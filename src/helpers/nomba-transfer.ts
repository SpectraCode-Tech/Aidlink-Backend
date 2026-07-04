import axios from "axios";
import { prisma } from "../middleware/auth.js";
import { getNombaAccessToken } from "../controllers/payments.controller.js";

/**
 * Triggers an outbound Nomba bank transfer to credit a partner's account.
 *
 * Endpoint: POST /v2/transfers/bank/{subAccountId}
 *
 * Key facts from Nomba docs:
 * - subAccountId goes in the URL PATH, not the header
 * - accountId header = parent account ID (source of authorization)
 * - amount is in NAIRA as a number (e.g. 50000), NOT Kobo
 * - merchantTxRef is an idempotency key — reuse the same ref on retries
 * - A 201 response means PENDING_BILLING — do NOT retry with a new reference,
 *   the final result arrives via payout_success / payout_failed webhook
 * - A 200 response means SUCCESS — mark payoutSettled = true immediately
 *
 * Returns: "SUCCESS" | "PENDING"
 */
export const triggerPartnerPayout = async (
  partnerId: string | null,
  fulfillmentRequestId: string,
): Promise<"SUCCESS" | "PENDING"> => {
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

  // IDEMPOTENCY: generate ref once, store it, reuse on retries
  let merchantTxRef = fulfillment.payoutReference;
  if (!merchantTxRef) {
    merchantTxRef = `AL-PAYOUT-${fulfillmentRequestId}-${Date.now()}`;
    await prisma.fulfillmentRequest.update({
      where: { id: fulfillmentRequestId },
      data: { payoutReference: merchantTxRef },
    });
  }

  const accessToken = await getNombaAccessToken();

  const response = await axios.post(
    // CORRECT: subAccountId in the URL path
    `${process.env.NOMBA_BASE_URL}/v2/transfers/bank/${process.env.NOMBA_SUB_ACCOUNT_ID}`,
    {
      amount: payoutAmountNaira, // NAIRA number — NOT Kobo
      accountNumber: partner.bankAccount,
      accountName: partner.bankAccountName,
      bankCode: partner.bankCode,
      merchantTxRef,
      senderName: "AidLink",
      narration: `Delivery payout — Fulfillment: ${fulfillmentRequestId}`,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accountId: process.env.NOMBA_ACCOUNT_ID, // parent account in header
      },
      // Must allow 201 — Nomba returns it for PENDING_BILLING transfers
      // axios throws on non-2xx by default, which would falsely mark pending as failed
      validateStatus: (status) => status === 200 || status === 201,
    },
  );

  // 201 = PENDING_BILLING — final status comes via payout_success webhook
  // 200 = SUCCESS — confirmed immediately
  return response.status === 201 ? "PENDING" : "SUCCESS";
};
