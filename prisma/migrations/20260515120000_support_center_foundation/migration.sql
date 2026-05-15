-- CreateEnum
CREATE TYPE "SupportRole" AS ENUM ('SUPPORT_VIEWER', 'SUPPORT_AGENT', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS');

-- CreateEnum
CREATE TYPE "SupportUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "SupportUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "SupportRole" NOT NULL DEFAULT 'SUPPORT_VIEWER',
    "status" "SupportUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "breakGlassExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportCasePriority" NOT NULL DEFAULT 'MEDIUM',
    "entityType" TEXT,
    "entityId" TEXT,
    "openedById" TEXT,
    "openedByName" TEXT,
    "assignedToId" TEXT,
    "assignedToName" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportNote" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "caseId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "authorRole" "SupportRole",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorUsername" TEXT,
    "actorRole" "SupportRole",
    "contaId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportUser_username_key" ON "SupportUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "SupportUser_email_key" ON "SupportUser"("email");

-- CreateIndex
CREATE INDEX "SupportUser_role_status_idx" ON "SupportUser"("role", "status");

-- CreateIndex
CREATE INDEX "SupportUser_status_idx" ON "SupportUser"("status");

-- CreateIndex
CREATE INDEX "SupportUser_breakGlassExpiresAt_idx" ON "SupportUser"("breakGlassExpiresAt");

-- CreateIndex
CREATE INDEX "SupportCase_contaId_status_updatedAt_idx" ON "SupportCase"("contaId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportCase_contaId_entityType_entityId_idx" ON "SupportCase"("contaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "SupportCase_status_priority_updatedAt_idx" ON "SupportCase"("status", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportCase_assignedToId_status_idx" ON "SupportCase"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "SupportNote_contaId_createdAt_idx" ON "SupportNote"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportNote_contaId_entityType_entityId_createdAt_idx" ON "SupportNote"("contaId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportNote_caseId_createdAt_idx" ON "SupportNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAuditLog_contaId_createdAt_idx" ON "SupportAuditLog"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAuditLog_actorId_createdAt_idx" ON "SupportAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAuditLog_action_createdAt_idx" ON "SupportAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAuditLog_entityType_entityId_createdAt_idx" ON "SupportAuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAuditLog_correlationId_idx" ON "SupportAuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "SupportAuditLog_createdAt_idx" ON "SupportAuditLog"("createdAt");
