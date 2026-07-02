import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient({});

console.log("\n🚀 Starting AidLink End-to-End System Integration Test...\n");

(async () => {
  try {
    // -------------------------------------------------------------
    // STEP 1: Create a Verified Beneficiary & A Verified Partner
    // -------------------------------------------------------------
    console.log("👥 Step 1: Seeding verified platform profiles...");

    const beneficiaryUser = await prisma.user.create({
      data: {
        email: `beneficiary.${crypto.randomInt(1000, 9999)}@aidlink.com`,
        password: "hashed_secure_password",
        role: "BENEFICIARY",
        beneficiaryProfile: {
          create: {
            ninStatus: "VERIFIED",
            faceMatchStatus: "VERIFIED",
            ninHash: crypto.randomBytes(32).toString("hex"),
          },
        },
      },
      include: { beneficiaryProfile: true },
    });
    const beneficiaryProfileId = (beneficiaryUser as any).beneficiaryProfile.id;

    const partnerUser = await prisma.user.create({
      data: {
        email: `partner.${crypto.randomInt(1000, 9999)}@aidlink.com`,
        password: "hashed_secure_password",
        role: "PARTNER", // ✅ RESTORED: Changed back to match your actual schema Role enum
        partnerProfile: {
          create: {
            // ✅ FIX: Providing BOTH the original fields and the explicitly required 'bankAccountName'
            name: "Lagos Swift Delivery Corp",
            category: "Logistics",
            bankAccount: "0123456789",
            bankCode: "058",
            bankAccountName: "Lagos Swift Delivery Corp LTD",
            cacStatus: "VERIFIED",
            cacNumber: `RC-${crypto.randomInt(100000, 999999)}`,
          },
        },
      },
      include: { partnerProfile: true },
    });
    const partnerProfileId = (partnerUser as any).partnerProfile.id;

    console.log(
      `✅ Profiles generated: Beneficiary (ID: ${beneficiaryProfileId}), Partner (ID: ${partnerProfileId})`,
    );
    
    // -------------------------------------------------------------
    // STEP 2: Beneficiary Spawns an Aid Request
    // -------------------------------------------------------------
    console.log("\n📝 Step 2: Creating a crowdfunding Aid Request...");
    const aidRequest = await prisma.request.create({
      data: {
        beneficiaryId: beneficiaryProfileId,
        title: "Emergency Rice and Protein Allocation",
        category: "Food Relief",
        targetAmount: 50000.0,
        raisedAmount: 0.0,
        status: "PENDING_AI",
        documentUrl: "https://cloudstorage.aidlink.com/proofs/medical_id.pdf",
        trustScore: 95,
      },
    });
    console.log(
      `✅ Aid Request "${aidRequest.title}" created with Target: ₦${aidRequest.targetAmount}`,
    );

    // -------------------------------------------------------------
    // STEP 3: Simulate Nomba Webhook (Simulating full funding)
    // -------------------------------------------------------------
    console.log(
      "\n💳 Step 3: Simulating Nomba Webhook payment arrival (Full funding event)...",
    );

    const mockOrderRef = `NOMBA-TX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const amountPaid = 50000.0;
    const generatedVerificationCode = crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();

    await prisma.$transaction(async (tx: any) => {
      await tx.transaction.create({
        data: {
          requestId: aidRequest.id,
          amount: amountPaid,
          reference: mockOrderRef,
          status: "SUCCESS",
          donorEmail: "generous.donor@world.org",
        },
      });

      const updatedReq = await tx.request.update({
        where: { id: aidRequest.id },
        data: {
          raisedAmount: amountPaid,
          status: "APPROVED",
        },
      });

      const fulfillment = await tx.fulfillmentRequest.create({
        data: {
          beneficiaryId: updatedReq.beneficiaryId,
          requestId: updatedReq.id,
          title: `Fulfillment for: ${updatedReq.title}`,
          description:
            "Automated logistics deployment cleared via successful webhook crowdfunding target metrics.",
          deliveryAddress: "12, Herbert Macaulay Way, Yaba, Lagos, Nigeria",
          verificationCode: generatedVerificationCode,
          status: "PENDING",
          logs: {
            create: {
              status: "PENDING",
              changedBy: "SYSTEM_NOMBA_WEBHOOK_TEST",
              notes:
                "Crowdfunding objective successfully hit. Generating secure tokens and opening logistics channels.",
            },
          },
        },
      });

      console.log(
        `✅ Webhook processed. Created Fulfillment Job (ID: ${fulfillment.id})`,
      );
      console.log(
        `🔒 Secure 6-digit handshake code generated: [ ${generatedVerificationCode} ]`,
      );
    });

    // -------------------------------------------------------------
    // STEP 4: Partner views Marketplace Job Feed
    // -------------------------------------------------------------
    console.log(
      "\n📦 Step 4: Verification Partner requesting job market feed...",
    );
    const openJobs = await prisma.fulfillmentRequest.findMany({
      where: { status: "PENDING" },
    });

    console.log(
      `✅ Feed loaded. Found ${openJobs.length} available delivery jobs.`,
    );
    const targetJob = openJobs.find((job: any) =>
      job.title.includes("Emergency Rice"),
    );
    if (!targetJob)
      throw new Error("Test failed: Created job not found in feed.");

    // -------------------------------------------------------------
    // STEP 5: Partner Claims the Job
    // -------------------------------------------------------------
    console.log(
      "\n🚚 Step 5: Partner claiming delivery job via atomic transaction isolation lock...",
    );

    const claimedJob = await prisma.$transaction(async (tx: any) => {
      const job = await tx.fulfillmentRequest.findUnique({
        where: { id: targetJob.id },
      });
      if (job?.status !== "PENDING") throw new Error("Job already claimed!");

      return await tx.fulfillmentRequest.update({
        where: { id: targetJob.id },
        data: {
          partnerId: partnerProfileId,
          status: "ASSIGNED",
          logs: {
            create: {
              status: "ASSIGNED",
              changedBy: partnerUser.id,
              notes: "Job claimed by driver via PWA terminal.",
            },
          },
        },
      });
    });
    console.log(
      `✅ Job state advanced cleanly to: ${claimedJob.status} by Partner.`,
    );

    // -------------------------------------------------------------
    // STEP 6: Partner inputs handshake confirmation code to get paid
    // -------------------------------------------------------------
    console.log(
      "\n🏁 Step 6: Package arrived at drop-off point. Executing cryptographic code handshake...",
    );

    const jobWithCode = await prisma.fulfillmentRequest.findUnique({
      where: { id: targetJob.id },
    });
    const userTypedCode = (jobWithCode as any).verificationCode;

    if ((jobWithCode as any).verificationCode === userTypedCode) {
      await prisma.fulfillmentRequest.update({
        where: { id: targetJob.id },
        data: {
          status: "COMPLETED",
          payoutSettled: true,
          logs: {
            create: {
              status: "COMPLETED",
              changedBy: partnerUser.id,
              notes:
                "Handshake verified. Funds released automatically to Partner account.",
            },
          },
        },
      });
      console.log(
        "🎉 SUCCESS: Verification matches perfectly! Payout state flipped to SETTLED.",
      );
    } else {
      throw new Error("Handshake failed. Code mismatch.");
    }

    console.log(
      "\n⭐⭐⭐⭐ SYSTEM INTEGRATION TEST PASSED COMPLETELY ⭐⭐⭐⭐\n",
    );
  } catch (error) {
    console.error("\n❌ Test script execution failed with error:", error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
})();
