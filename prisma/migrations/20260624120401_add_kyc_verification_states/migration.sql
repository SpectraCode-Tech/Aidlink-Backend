/*
  Warnings:

  - You are about to drop the column `nin` on the `Beneficiary` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ninHash]` on the table `Beneficiary` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[cacNumber]` on the table `FulfillmentPartner` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'FAILED');

-- DropIndex
DROP INDEX "Beneficiary_nin_key";

-- AlterTable
ALTER TABLE "Beneficiary" DROP COLUMN "nin",
ADD COLUMN     "faceMatchStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "ninHash" TEXT,
ADD COLUMN     "ninStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- AlterTable
ALTER TABLE "FulfillmentPartner" ADD COLUMN     "cacNumber" TEXT,
ADD COLUMN     "cacStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateIndex
CREATE UNIQUE INDEX "Beneficiary_ninHash_key" ON "Beneficiary"("ninHash");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentPartner_cacNumber_key" ON "FulfillmentPartner"("cacNumber");
