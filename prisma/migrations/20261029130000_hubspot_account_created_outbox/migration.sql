CREATE TABLE "HubSpotAccountCreatedOutbox" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "claimToken" TEXT,
  "contactId" TEXT,
  "noteId" TEXT,
  "noteAttemptedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HubSpotAccountCreatedOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HubSpotAccountCreatedOutbox_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HubSpotAccountCreatedOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'FAILED', 'DELIVERED')),
  CONSTRAINT "HubSpotAccountCreatedOutbox_delivered_check" CHECK ("status" <> 'DELIVERED' OR ("contactId" IS NOT NULL AND "noteId" IS NOT NULL AND "deliveredAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "HubSpotAccountCreatedOutbox_contaId_key" ON "HubSpotAccountCreatedOutbox"("contaId");
CREATE INDEX "HubSpotAccountCreatedOutbox_status_availableAt_createdAt_idx" ON "HubSpotAccountCreatedOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "HubSpotAccountCreatedOutbox_contaId_status_idx" ON "HubSpotAccountCreatedOutbox"("contaId", "status");

ALTER TABLE "HubSpotAccountCreatedOutbox" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HubSpotAccountCreatedOutbox"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."HubSpotAccountCreatedOutbox" TO alusa_app;
  END IF;
END $$;
