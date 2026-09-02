-- Registra quem concedeu a elevação para permitir auditoria operacional completa.
ALTER TABLE "TemporaryElevation" ADD COLUMN "grantedByAdminUserId" TEXT;
CREATE INDEX "TemporaryElevation_grantedByAdminUserId_createdAt_idx"
  ON "TemporaryElevation"("grantedByAdminUserId", "createdAt");
