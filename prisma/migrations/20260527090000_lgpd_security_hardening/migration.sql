-- LGPD/security hardening baseline.
-- Removes local card token storage and adds audit-oriented privacy tables.

ALTER TABLE "Responsavel" DROP COLUMN IF EXISTS "asaasCreditCardToken";

CREATE TABLE "LegalAcceptance" (
  "id" TEXT NOT NULL,
  "contaId" TEXT,
  "userId" TEXT,
  "documentType" TEXT NOT NULL,
  "documentVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  "source" TEXT NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CookieConsent" (
  "id" TEXT NOT NULL,
  "anonymousId" TEXT,
  "userId" TEXT,
  "categories" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "policyVersion" TEXT NOT NULL,
  CONSTRAINT "CookieConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyRequest" (
  "id" TEXT NOT NULL,
  "contaId" TEXT,
  "userId" TEXT,
  "requestType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "action" TEXT,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "requesterEmail" TEXT,
  "requesterName" TEXT,
  "details" TEXT,
  "resultUrl" TEXT,
  "rejectedReason" TEXT,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SensitiveAccessLog" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "reason" TEXT,
  "requestId" TEXT,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SensitiveAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "userId" TEXT,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT,
  "consentType" TEXT NOT NULL,
  "legalBasis" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'GRANTED',
  "documentVersion" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "source" TEXT NOT NULL,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegalAcceptance_contaId_idx" ON "LegalAcceptance"("contaId");
CREATE INDEX "LegalAcceptance_userId_idx" ON "LegalAcceptance"("userId");
CREATE INDEX "LegalAcceptance_documentType_documentVersion_idx" ON "LegalAcceptance"("documentType", "documentVersion");
CREATE INDEX "idx_legal_acceptance_conta_doc_version" ON "LegalAcceptance"("contaId", "documentType", "documentVersion");

CREATE INDEX "CookieConsent_anonymousId_idx" ON "CookieConsent"("anonymousId");
CREATE INDEX "CookieConsent_userId_idx" ON "CookieConsent"("userId");
CREATE INDEX "CookieConsent_policyVersion_idx" ON "CookieConsent"("policyVersion");

CREATE INDEX "idx_privacy_request_conta_status" ON "PrivacyRequest"("contaId", "status");
CREATE INDEX "PrivacyRequest_userId_idx" ON "PrivacyRequest"("userId");
CREATE INDEX "PrivacyRequest_requestType_status_idx" ON "PrivacyRequest"("requestType", "status");
CREATE INDEX "PrivacyRequest_createdAt_idx" ON "PrivacyRequest"("createdAt");

CREATE INDEX "idx_sensitive_access_conta_created" ON "SensitiveAccessLog"("contaId", "createdAt");
CREATE INDEX "idx_sensitive_access_conta_action" ON "SensitiveAccessLog"("contaId", "action", "createdAt");
CREATE INDEX "idx_sensitive_access_actor" ON "SensitiveAccessLog"("actorUserId", "createdAt");
CREATE INDEX "idx_sensitive_access_entity" ON "SensitiveAccessLog"("entityType", "entityId");
CREATE INDEX "SensitiveAccessLog_requestId_idx" ON "SensitiveAccessLog"("requestId");

CREATE INDEX "idx_consent_record_subject" ON "ConsentRecord"("contaId", "subjectType", "subjectId");
CREATE INDEX "idx_consent_record_type_status" ON "ConsentRecord"("contaId", "consentType", "status");
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord"("userId");

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LegalAcceptance"
  ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CookieConsent"
  ADD CONSTRAINT "CookieConsent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "PrivacyRequest_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "PrivacyRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SensitiveAccessLog"
  ADD CONSTRAINT "SensitiveAccessLog_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SensitiveAccessLog"
  ADD CONSTRAINT "SensitiveAccessLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord"
  ADD CONSTRAINT "ConsentRecord_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsentRecord"
  ADD CONSTRAINT "ConsentRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE SCHEMA IF NOT EXISTS app_security;

CREATE OR REPLACE FUNCTION app_security.current_conta_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_conta_id', true), '')
$$;

DO $$
DECLARE
  rel_name text;
  tenant_tables text[] := ARRAY[
    'LegalAcceptance',
    'PrivacyRequest',
    'SensitiveAccessLog',
    'ConsentRecord'
  ];
BEGIN
  FOREACH rel_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', rel_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (%I = app_security.current_conta_id()) WITH CHECK (%I = app_security.current_conta_id())',
      rel_name,
      'contaId',
      'contaId'
    );
  END LOOP;
END $$;
