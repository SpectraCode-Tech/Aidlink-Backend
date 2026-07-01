/*
  Warnings:

  - Added the required column `bankAccountName` to the `FulfillmentPartner` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FulfillmentPartner" ADD COLUMN     "bankAccountName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "FulfillmentRequest" ADD COLUMN     "payoutReference" TEXT;
