CREATE TYPE "PlatformSchoolInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "PlatformSchoolInvitationCondition" AS ENUM ('STANDARD', 'CUSTOM');

CREATE TABLE "PlatformSchoolInvitation" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "requestIdempotencyKey" TEXT NOT NULL,
  "schoolName" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "conditionType" "PlatformSchoolInvitationCondition" NOT NULL DEFAULT 'STANDARD',
  "planCode" "PlatformBillingPlanCode",
  "monthlyAmountCents" INTEGER,
  "stripePriceId" TEXT,
  "studentCount" INTEGER,
  "trialDays" INTEGER NOT NULL DEFAULT 14,
  "currentConditionVersion" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "PlatformSchoolInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "acceptedAt" TIMESTAMP(3),
  "acceptedContaId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "emailDeliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "emailSentAt" TIMESTAMP(3),
  "emailDeliveryErrorCode" TEXT,
  "emailResendRequestKey" TEXT,
  "emailResentAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSchoolInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSchoolInvitation_trialDays_check" CHECK ("trialDays" IN (0, 7, 14, 21, 30, 60, 90)),
  CONSTRAINT "PlatformSchoolInvitation_studentCount_check" CHECK ("studentCount" IS NULL OR "studentCount" >= 1),
  CONSTRAINT "PlatformSchoolInvitation_condition_check" CHECK (
    ("conditionType" = 'STANDARD' AND "planCode" IS NOT NULL AND "studentCount" IS NOT NULL AND "studentCount" <= 500 AND "monthlyAmountCents" IS NULL AND "stripePriceId" IS NULL)
    OR ("conditionType" = 'CUSTOM' AND "studentCount" IS NOT NULL AND "monthlyAmountCents" IS NOT NULL AND "monthlyAmountCents" > 0 AND "stripePriceId" IS NOT NULL)
  ),
  CONSTRAINT "PlatformSchoolInvitation_accepted_state_check" CHECK (
    "status" <> 'ACCEPTED' OR ("acceptedAt" IS NOT NULL AND "acceptedContaId" IS NOT NULL)
  )
);

CREATE TABLE "PlatformSchoolInvitationHistory" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSchoolInvitationHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSchoolInvitationConditionVersion" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSchoolInvitationConditionVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformSchoolInvitationConditionVersion_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "PlatformSchoolInvitationConditionAcceptance" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contaId" TEXT NOT NULL,
  "acceptedBy" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformSchoolInvitation_tokenHash_key" ON "PlatformSchoolInvitation"("tokenHash");
CREATE UNIQUE INDEX "PlatformSchoolInvitation_requestIdempotencyKey_key" ON "PlatformSchoolInvitation"("requestIdempotencyKey");
CREATE UNIQUE INDEX "PlatformSchoolInvitation_acceptedContaId_key" ON "PlatformSchoolInvitation"("acceptedContaId");
CREATE INDEX "PlatformSchoolInvitation_status_expiresAt_createdAt_idx" ON "PlatformSchoolInvitation"("status", "expiresAt", "createdAt");
CREATE INDEX "PlatformSchoolInvitation_email_status_idx" ON "PlatformSchoolInvitation"("email", "status");
CREATE INDEX "PlatformSchoolInvitationHistory_invitationId_createdAt_idx" ON "PlatformSchoolInvitationHistory"("invitationId", "createdAt");
CREATE UNIQUE INDEX "PlatformSchoolInvitationConditionVersion_invitationId_version_key" ON "PlatformSchoolInvitationConditionVersion"("invitationId", "version");
CREATE INDEX "PlatformSchoolInvitationConditionVersion_invitationId_createdAt_idx" ON "PlatformSchoolInvitationConditionVersion"("invitationId", "createdAt");
CREATE UNIQUE INDEX "PlatformSchoolInvitationConditionAcceptance_invitationId_version_contaId_key" ON "PlatformSchoolInvitationConditionAcceptance"("invitationId", "version", "contaId");
CREATE INDEX "PlatformSchoolInvitationConditionAcceptance_contaId_invitationId_version_idx" ON "PlatformSchoolInvitationConditionAcceptance"("contaId", "invitationId", "version");

ALTER TABLE "PlatformSchoolInvitation" ADD CONSTRAINT "PlatformSchoolInvitation_acceptedContaId_fkey" FOREIGN KEY ("acceptedContaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformSchoolInvitationHistory" ADD CONSTRAINT "PlatformSchoolInvitationHistory_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "PlatformSchoolInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformSchoolInvitationConditionVersion" ADD CONSTRAINT "PlatformSchoolInvitationConditionVersion_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "PlatformSchoolInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformSchoolInvitationConditionAcceptance" ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "PlatformSchoolInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformSchoolInvitationConditionAcceptance" ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_invitationId_version_fkey" FOREIGN KEY ("invitationId", "version") REFERENCES "PlatformSchoolInvitationConditionVersion"("invitationId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformSchoolInvitationConditionAcceptance" ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_platform_school_invitation_condition_version_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Platform school invitation agreement versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PlatformSchoolInvitationConditionVersion_immutable"
BEFORE UPDATE OR DELETE ON "PlatformSchoolInvitationConditionVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_platform_school_invitation_condition_version_mutation"();
