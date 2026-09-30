CREATE TABLE "TenantUploadQuota" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "reservedBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantUploadQuota_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantUploadQuota_id_contaId_key" ON "TenantUploadQuota"("id", "contaId");
CREATE UNIQUE INDEX "TenantUploadQuota_contaId_periodStart_key" ON "TenantUploadQuota"("contaId", "periodStart");
CREATE INDEX "TenantUploadQuota_contaId_periodStart_idx" ON "TenantUploadQuota"("contaId", "periodStart");
ALTER TABLE "TenantUploadQuota" ADD CONSTRAINT "TenantUploadQuota_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenantUploadReservation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "quotaId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "expectedSize" BIGINT NOT NULL,
  "contentType" TEXT NOT NULL,
  "finalObjectKey" TEXT,
  "pendingCleanedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "TenantUploadReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TenantUploadReservation_contaId_objectKey_idx" ON "TenantUploadReservation"("contaId", "objectKey");
CREATE INDEX "TenantUploadReservation_contaId_status_expiresAt_idx" ON "TenantUploadReservation"("contaId", "status", "expiresAt");
CREATE INDEX "TenantUploadReservation_quotaId_status_idx" ON "TenantUploadReservation"("quotaId", "status");
ALTER TABLE "TenantUploadReservation" ADD CONSTRAINT "TenantUploadReservation_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantUploadReservation" ADD CONSTRAINT "TenantUploadReservation_quotaId_contaId_fkey" FOREIGN KEY ("quotaId", "contaId") REFERENCES "TenantUploadQuota"("id", "contaId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantUploadQuota" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantUploadReservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantUploadQuota" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());
CREATE POLICY tenant_isolation ON "TenantUploadReservation" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());
