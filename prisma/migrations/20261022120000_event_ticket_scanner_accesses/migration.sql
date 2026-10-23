CREATE TABLE "EventTicketScannerAccess" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "operatorName" VARCHAR(120) NOT NULL,
  "gateName" VARCHAR(120) NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventTicketScannerAccess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_event_ticket_scanner_access_conta_event_created"
  ON "EventTicketScannerAccess"("contaId", "eventId", "createdAt");

ALTER TABLE "EventTicketScannerAccess"
  ADD CONSTRAINT "EventTicketScannerAccess_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicketScannerAccess_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SchoolEvent"
  ADD CONSTRAINT "uq_school_event_conta_id" UNIQUE ("contaId", "id");

ALTER TABLE "EventTicketScannerAccess"
  ADD CONSTRAINT "EventTicketScannerAccess_contaId_eventId_fkey"
    FOREIGN KEY ("contaId", "eventId") REFERENCES "SchoolEvent"("contaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventTicketScannerAccess" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EventTicketScannerAccess"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "EventTicketScannerAccess" TO alusa_app;
  END IF;
END $$;
