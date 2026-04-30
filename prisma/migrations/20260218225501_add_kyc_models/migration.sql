-- CreateEnum
CREATE TYPE "KycProcessStatus" AS ENUM ('NOT_STARTED', 'WAITING_MIN_TIMEOUT', 'PENDING_DOCUMENTS', 'EXTERNAL_IN_PROGRESS', 'INTERNAL_UPLOADING', 'UNDER_REVIEW', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "KycSubmissionMethod" AS ENUM ('EXTERNAL_ONBOARDING_URL', 'INTERNAL_UPLOAD');

-- CreateEnum
CREATE TYPE "KycDocumentStatus" AS ENUM ('NOT_SENT', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED');

-- CreateTable
CREATE TABLE "KycProcess" (
    "id" TEXT NOT NULL,
    "asaasAccountId" TEXT NOT NULL,
    "status" "KycProcessStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "rejectReasons" TEXT[],
    "nextAllowedDocsFetchAt" TIMESTAMP(3),
    "lastWebhookEventId" TEXT,
    "lastAsaasSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRequirement" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT,
    "title" TEXT,
    "description" TEXT,
    "submissionMethod" "KycSubmissionMethod" NOT NULL,
    "status" "KycDocumentStatus" NOT NULL DEFAULT 'NOT_SENT',
    "responsibleName" TEXT,
    "responsibleType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycSlot" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "status" "KycDocumentStatus" NOT NULL DEFAULT 'NOT_SENT',
    "uploadedFileId" TEXT,
    "uiLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KycProcess_asaasAccountId_key" ON "KycProcess"("asaasAccountId");

-- CreateIndex
CREATE INDEX "KycProcess_asaasAccountId_idx" ON "KycProcess"("asaasAccountId");

-- CreateIndex
CREATE INDEX "KycProcess_status_idx" ON "KycProcess"("status");

-- CreateIndex
CREATE INDEX "KycRequirement_processId_idx" ON "KycRequirement"("processId");

-- CreateIndex
CREATE INDEX "KycRequirement_status_idx" ON "KycRequirement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KycRequirement_processId_groupId_key" ON "KycRequirement"("processId", "groupId");

-- CreateIndex
CREATE INDEX "KycSlot_requirementId_idx" ON "KycSlot"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "KycSlot_requirementId_slotId_key" ON "KycSlot"("requirementId", "slotId");

-- AddForeignKey
ALTER TABLE "KycProcess" ADD CONSTRAINT "KycProcess_asaasAccountId_fkey" FOREIGN KEY ("asaasAccountId") REFERENCES "AsaasAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRequirement" ADD CONSTRAINT "KycRequirement_processId_fkey" FOREIGN KEY ("processId") REFERENCES "KycProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycSlot" ADD CONSTRAINT "KycSlot_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "KycRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
