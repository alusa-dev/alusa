-- CreateTable
CREATE TABLE "EarlyAccessLead" (
    "id" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "studentsRange" TEXT,
    "mainChallenge" TEXT,
    "source" TEXT NOT NULL DEFAULT 'acesso-antecipado',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarlyAccessLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarlyAccessLead_email_key" ON "EarlyAccessLead"("email");

-- CreateIndex
CREATE INDEX "EarlyAccessLead_createdAt_idx" ON "EarlyAccessLead"("createdAt");

-- CreateIndex
CREATE INDEX "EarlyAccessLead_source_createdAt_idx" ON "EarlyAccessLead"("source", "createdAt");
