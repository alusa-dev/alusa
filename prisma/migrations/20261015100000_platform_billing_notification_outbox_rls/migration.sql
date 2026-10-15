ALTER TABLE public."PlatformBillingNotificationOutbox" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public."PlatformBillingNotificationOutbox"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."PlatformBillingNotificationOutbox" TO alusa_app;
  END IF;
END $$;
