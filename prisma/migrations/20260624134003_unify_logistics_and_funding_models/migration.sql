/*
  Warnings:

  - You are about to drop the `Delivery` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_partnerId_fkey";

-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_requestId_fkey";

-- AlterTable
ALTER TABLE "FulfillmentRequest" ADD COLUMN     "payoutSettled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proofUrl" TEXT,
ADD COLUMN     "requestId" TEXT;

-- DropTable
DROP TABLE "Delivery";

-- AddForeignKey
ALTER TABLE "FulfillmentRequest" ADD CONSTRAINT "FulfillmentRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
