-- Fase 4: identidade administrativa canônica, sessões persistentes e elevação temporária.
-- Expansão aditiva: SupportUser e o cookie JWT legado permanecem válidos durante o cutover.

CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'SUPPORT', 'FINANCE_OPS', 'ENGINEERING', 'READ_ONLY');
CREATE TYPE "AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'READ_ONLY',
    "status" "AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "legacySupportUserId" TEXT,
    "legacySupportRole" "SupportRole",
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemporaryElevation" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "sourceSupportUserId" TEXT,
    "reason" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TemporaryElevation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE UNIQUE INDEX "AdminUser_legacySupportUserId_key" ON "AdminUser"("legacySupportUserId");
CREATE INDEX "AdminUser_role_status_idx" ON "AdminUser"("role", "status");
CREATE INDEX "AdminUser_status_idx" ON "AdminUser"("status");
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_adminUserId_revokedAt_idx" ON "AdminSession"("adminUserId", "revokedAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE INDEX "AdminSession_revokedAt_expiresAt_idx" ON "AdminSession"("revokedAt", "expiresAt");
CREATE UNIQUE INDEX "TemporaryElevation_sourceSupportUserId_key" ON "TemporaryElevation"("sourceSupportUserId");
CREATE INDEX "TemporaryElevation_adminUserId_revokedAt_expiresAt_idx" ON "TemporaryElevation"("adminUserId", "revokedAt", "expiresAt");
CREATE INDEX "TemporaryElevation_expiresAt_idx" ON "TemporaryElevation"("expiresAt");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemporaryElevation" ADD CONSTRAINT "TemporaryElevation_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
