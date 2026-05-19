-- Tenant RLS for charge/cobranca file attachments (no direct contaId column).

ALTER TABLE public."ArquivoCharge" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."ArquivoCharge";
CREATE POLICY tenant_isolation ON public."ArquivoCharge"
  USING (
    EXISTS (
      SELECT 1
      FROM public."Charge" c
      WHERE c.id = "ArquivoCharge"."chargeId"
        AND c."contaId" = app_security.current_conta_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public."Charge" c
      WHERE c.id = "ArquivoCharge"."chargeId"
        AND c."contaId" = app_security.current_conta_id()
    )
  );

ALTER TABLE public."ArquivoCobranca" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."ArquivoCobranca";
CREATE POLICY tenant_isolation ON public."ArquivoCobranca"
  USING (
    EXISTS (
      SELECT 1
      FROM public."Cobranca" cob
      WHERE cob.id = "ArquivoCobranca"."cobrancaId"
        AND cob."contaId" = app_security.current_conta_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public."Cobranca" cob
      WHERE cob.id = "ArquivoCobranca"."cobrancaId"
        AND cob."contaId" = app_security.current_conta_id()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ArquivoCharge" TO alusa_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ArquivoCobranca" TO alusa_app';
  END IF;
END $$;
