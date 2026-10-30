CREATE TYPE "ExpertContactLeadDeliveryState" AS ENUM (
  'PENDING',
  'NOTE_CREATING',
  'DELIVERED',
  'EXPIRED'
);

CREATE TABLE "ExpertContactLeadDelivery" (
  "requestId" UUID NOT NULL,
  "payloadHash" CHAR(64),
  "contactName" TEXT,
  "email" TEXT,
  "institutionName" TEXT,
  "institutionWebsite" TEXT,
  "phone" TEXT,
  "institutionType" TEXT,
  "studentsRange" TEXT,
  "state" "ExpertContactLeadDeliveryState" NOT NULL DEFAULT 'PENDING',
  "noteId" TEXT,
  "noteAttemptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpertContactLeadDelivery_pkey" PRIMARY KEY ("requestId"),
  CONSTRAINT "ExpertContactLeadDelivery_delivered_requires_note" CHECK (
    "state" <> 'DELIVERED' OR ("noteId" IS NOT NULL AND "deliveredAt" IS NOT NULL)
  ),
  CONSTRAINT "ExpertContactLeadDelivery_expired_is_redacted" CHECK (
    "state" <> 'EXPIRED' OR (
      "contactName" IS NULL AND "email" IS NULL AND "institutionName" IS NULL AND "institutionWebsite" IS NULL AND
      "phone" IS NULL AND "institutionType" IS NULL AND "studentsRange" IS NULL AND
      "payloadHash" IS NULL
    )
  )
);

CREATE INDEX "ExpertContactLeadDelivery_state_createdAt_idx"
  ON "ExpertContactLeadDelivery"("state", "createdAt");

CREATE INDEX "ExpertContactLeadDelivery_payloadHash_updatedAt_idx"
  ON "ExpertContactLeadDelivery"("payloadHash", "updatedAt");
