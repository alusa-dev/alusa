BEGIN;

CREATE TYPE "InviteEmailDeliveryStatus" AS ENUM (
  'UNKNOWN',
  'PENDING',
  'SENT',
  'LOGGED',
  'FAILED',
  'NOT_APPLICABLE'
);

CREATE TYPE "InviteResendRequestStatus" AS ENUM (
  'PROCESSING',
  'SENT',
  'LOGGED',
  'FAILED',
  'NOT_APPLICABLE'
);

ALTER TABLE "Invite"
  ADD COLUMN "emailDeliveryStatus" "InviteEmailDeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeliveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastDeliveryErrorCode" VARCHAR(64),
  ADD COLUMN "resendAvailableAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "uq_invite_id_conta" ON "Invite"("id", "contaId");

CREATE TABLE "InviteResendRequest" (
  "id" TEXT NOT NULL,
  "inviteId" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "requestKeyFingerprint" VARCHAR(64) NOT NULL,
  "status" "InviteResendRequestStatus" NOT NULL DEFAULT 'PROCESSING',
  "deliveryErrorCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "InviteResendRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_invite_resend_request_key"
  ON "InviteResendRequest"("inviteId", "requestKeyFingerprint");
CREATE INDEX "idx_invite_resend_conta_invite_created"
  ON "InviteResendRequest"("contaId", "inviteId", "createdAt");

ALTER TABLE "InviteResendRequest"
  ADD CONSTRAINT "InviteResendRequest_inviteId_contaId_fkey"
  FOREIGN KEY ("inviteId", "contaId")
  REFERENCES "Invite"("id", "contaId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InviteResendRequest"
  ADD CONSTRAINT "InviteResendRequest_contaId_fkey"
  FOREIGN KEY ("contaId")
  REFERENCES "Conta"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InviteResendRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InviteResendRequest"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

COMMIT;
