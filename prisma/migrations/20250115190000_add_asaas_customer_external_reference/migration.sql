-- Add Asaas customer external reference fields (guarded for reset order)
DO $$
BEGIN
  IF to_regclass('public."Aluno"') IS NOT NULL THEN
    ALTER TABLE "Aluno" ADD COLUMN IF NOT EXISTS "asaasCustomerExternalReference" TEXT;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Aluno_contaId_asaasCustomerExternalReference_key" ON "Aluno" ("contaId", "asaasCustomerExternalReference")';
  END IF;

  IF to_regclass('public."Responsavel"') IS NOT NULL THEN
    ALTER TABLE "Responsavel" ADD COLUMN IF NOT EXISTS "asaasCustomerExternalReference" TEXT;
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Responsavel_asaasCustomerExternalReference_key" ON "Responsavel" ("asaasCustomerExternalReference")';
  END IF;
END $$;
