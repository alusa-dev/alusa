ALTER TABLE "AsaasAccount"
ADD COLUMN "sandboxApprovalRequestedAt" TIMESTAMP(3),
ADD COLUMN "lastAccountStatusEventAt" TIMESTAMP(3);

CREATE INDEX "AsaasAccount_sandboxApprovalRequestedAt_idx"
ON "AsaasAccount"("sandboxApprovalRequestedAt");
