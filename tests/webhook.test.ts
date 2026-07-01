import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../src/app.js";
import { prisma } from "../src/middleware/auth.js";

const SIGNING_SECRET = "test_nomba_secret_key_12345";
process.env.NOMBA_SIGNING_SECRET = SIGNING_SECRET;

describe("Nomba Webhook Receptor E2E Test Suite", () => {
  let mockRequestId: string;
  let mockBeneficiaryId: string;

  beforeEach(async () => {
        await prisma.securityAccessLog.deleteMany({});
    await prisma.accessPass.deleteMany({});
    await prisma.fulfillmentLog.deleteMany({});
    await prisma.fulfillmentRequest.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.request.deleteMany({});
    await prisma.beneficiary.deleteMany({});
    await prisma.user.deleteMany({});

        const user = await prisma.user.create({
      data: {
        email: `test.beneficiary.${crypto.randomInt(100, 999)}@aidlink.com`,
        password: "hashed_password",
        role: "BENEFICIARY",
        beneficiaryProfile: {
          create: {
            ninStatus: "VERIFIED",
            faceMatchStatus: "VERIFIED",
          },
        },
      },
      include: { beneficiaryProfile: true },
    });

    mockBeneficiaryId = user.beneficiaryProfile!.id;

        const aidRequest = await prisma.request.create({
      data: {
        beneficiaryId: mockBeneficiaryId,
        title: "Medical Supply Batch A",
        category: "Health Relief",
        targetAmount: 150000.0,         raisedAmount: 0.0,
        status: "PENDING_AI",
        documentUrl: "https://cloudstorage.aidlink.com/proofs/test.pdf"},
    });

    mockRequestId = aidRequest.id;
  });

    const generateMockNombaHeaders = (payload: object) => {
    const rawPayloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", SIGNING_SECRET)
      .update(rawPayloadString)
      .digest("hex");

    return {
      "Content-Type": "application/json",
      "nomba-signature": signature,
    };
  };

        it("should successfully verify signature, update request, log ledger, and spin up fulfillment engines if target is met", async () => {
    const paymentPayload = {
      event_type: "payment_success",
      data: {
        reference: `REFR-SUCCESS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        amount: "150000.00",
        customer: { email: "donor.prime@domain.org" },
        metadata: { requestId: mockRequestId },
      },
    };

    const headers = generateMockNombaHeaders(paymentPayload);

const response = await request(app)
  .post("/webhooks/payments/nomba-webhook")   .set(headers)
  .send(paymentPayload);

        expect(response.status).toBe(200);
    expect(response.body.status).toBe("SUCCESS");

        const savedTx = await prisma.transaction.findUnique({
      where: { reference: paymentPayload.data.reference },
    });
    expect(savedTx).toBeDefined();
    expect(Number(savedTx?.amount)).toBe(150000.0);

        const updatedRequest = await prisma.request.findUnique({
      where: { id: mockRequestId },
    });
    expect(Number(updatedRequest?.raisedAmount)).toBe(150000.0);
    expect(updatedRequest?.status).toBe("APPROVED");

        const fulfillment = await prisma.fulfillmentRequest.findFirst({
      where: { requestId: mockRequestId },
      include: { logs: true },
    });
    expect(fulfillment).toBeDefined();
    expect(fulfillment?.status).toBe("PENDING");
    expect(fulfillment?.verificationCode).toHaveLength(6);
    expect(fulfillment?.logs[0].status).toBe("PENDING");
  });

        it("should gracefully block duplicate operations on identical payment references (Idempotency Guard)", async () => {
    const targetReference = "UNIQUE-IDEMPOTENCY-REF-TOKEN";
    const paymentPayload = {
      event_type: "payment_success",
      data: {
        reference: targetReference,
        amount: "1000.00",
        customer: { email: "donor.duplicate@domain.org" },
        metadata: { requestId: mockRequestId },
      },
    };

    const headers = generateMockNombaHeaders(paymentPayload);

       const firstCall = await request(app)
     .post("/webhooks/payments/nomba-webhook")      .set(headers)
     .send(paymentPayload);
    expect(firstCall.status).toBe(200);

        const secondCall = await request(app)
      .post("/webhooks/payments/nomba-webhook")       .set(headers)
      .send(paymentPayload);
    expect(secondCall.status).toBe(200);

        const verifiedRequest = await prisma.request.findUnique({
      where: { id: mockRequestId },
    });
    expect(Number(verifiedRequest?.raisedAmount)).toBe(1000.0);
  });

        it("should aggressively return 401 Unauthorized if payload body elements are modified post-signing", async () => {
    const paymentPayload = {
      event_type: "payment_success",
      data: {
        reference: "TAMPER-TEST-REF",
        amount: "50000.00",
        metadata: { requestId: mockRequestId },
      },
    };

    const legitimateHeaders = generateMockNombaHeaders(paymentPayload);

        const maliciousPayload = {
      ...paymentPayload,
      data: { ...paymentPayload.data, amount: "99999999.00" },
    };

    const response = await request(app)
      .post("/webhooks/payments/nomba-webhook")       .set(legitimateHeaders)
      .send(maliciousPayload);

        expect(response.status).toBe(401);
  });
});
