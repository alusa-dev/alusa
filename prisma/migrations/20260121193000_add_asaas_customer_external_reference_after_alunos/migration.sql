-- Add Asaas customer external reference fields after core tables exist
ALTER TABLE "Aluno" ADD COLUMN IF NOT EXISTS "asaasCustomerExternalReference" TEXT;
ALTER TABLE "Responsavel" ADD COLUMN IF NOT EXISTS "asaasCustomerExternalReference" TEXT;

-- Unique constraints for externalReference mapping
CREATE UNIQUE INDEX IF NOT EXISTS "Aluno_contaId_asaasCustomerExternalReference_key"
  ON "Aluno" ("contaId", "asaasCustomerExternalReference");

CREATE UNIQUE INDEX IF NOT EXISTS "Responsavel_asaasCustomerExternalReference_key"
  ON "Responsavel" ("asaasCustomerExternalReference");
