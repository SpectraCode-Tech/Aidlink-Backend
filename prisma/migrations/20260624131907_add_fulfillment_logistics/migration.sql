-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FulfillmentRequest" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "partnerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "deliveryAddress" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "verificationCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "FulfillmentStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FulfillmentRequest_status_idx" ON "FulfillmentRequest"("status");

-- CreateIndex
CREATE INDEX "FulfillmentRequest_beneficiaryId_idx" ON "FulfillmentRequest"("beneficiaryId");

-- AddForeignKey
ALTER TABLE "FulfillmentRequest" ADD CONSTRAINT "FulfillmentRequest_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequest" ADD CONSTRAINT "FulfillmentRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "FulfillmentPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentLog" ADD CONSTRAINT "FulfillmentLog_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FulfillmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
