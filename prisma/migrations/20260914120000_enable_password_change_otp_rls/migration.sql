-- Password-change OTP challenges are tenant-scoped authentication records.
-- Keep the owner-compatible RLS rollout used by the rest of the application:
-- the runtime role receives the tenant context through runWithTenant.

ALTER TABLE "PasswordChangeOtp" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "PasswordChangeOtp";

CREATE POLICY tenant_isolation ON "PasswordChangeOtp"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PasswordChangeOtp" TO alusa_app';
  END IF;
END $$;
