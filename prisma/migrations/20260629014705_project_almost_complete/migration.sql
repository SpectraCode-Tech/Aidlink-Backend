-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- CreateIndex
CREATE INDEX "FulfillmentLog_requestId_idx" ON "FulfillmentLog"("requestId");

-- CreateIndex
CREATE INDEX "FulfillmentLog_status_idx" ON "FulfillmentLog"("status");

-- CreateIndex
CREATE INDEX "FulfillmentRequest_partnerId_idx" ON "FulfillmentRequest"("partnerId");

-- CreateIndex
CREATE INDEX "FulfillmentRequest_requestId_idx" ON "FulfillmentRequest"("requestId");

-- CreateIndex
CREATE INDEX "Request_beneficiaryId_idx" ON "Request"("beneficiaryId");

-- CreateIndex
CREATE INDEX "SecurityAccessLog_passId_idx" ON "SecurityAccessLog"("passId");

-- CreateIndex
CREATE INDEX "Transaction_requestId_idx" ON "Transaction"("requestId");
