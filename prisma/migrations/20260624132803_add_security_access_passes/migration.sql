-- CreateEnum
CREATE TYPE "AccessPassStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "AccessPass" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "purpose" TEXT,
    "passCode" TEXT NOT NULL,
    "status" "AccessPassStatus" NOT NULL DEFAULT 'ACTIVE',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAccessLog" (
    "id" TEXT NOT NULL,
    "passId" TEXT,
    "action" TEXT NOT NULL,
    "checkpointBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessPass_passCode_key" ON "AccessPass"("passCode");

-- CreateIndex
CREATE INDEX "AccessPass_passCode_idx" ON "AccessPass"("passCode");

-- CreateIndex
CREATE INDEX "AccessPass_creatorId_idx" ON "AccessPass"("creatorId");

-- AddForeignKey
ALTER TABLE "SecurityAccessLog" ADD CONSTRAINT "SecurityAccessLog_passId_fkey" FOREIGN KEY ("passId") REFERENCES "AccessPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
