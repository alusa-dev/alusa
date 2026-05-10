-- Harden Asaas customer identifiers for tenant isolation.
-- These identifiers must not block another school when the same external id appears under another contaId.

DROP INDEX IF EXISTS "Aluno_asaasId_key";
DROP INDEX IF EXISTS "Aluno_asaasCustomerId_key";
DROP INDEX IF EXISTS "Customer_asaasCustomerId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Aluno_contaId_asaasId_key"
  ON "Aluno"("contaId", "asaasId");

CREATE UNIQUE INDEX IF NOT EXISTS "Aluno_contaId_asaasCustomerId_key"
  ON "Aluno"("contaId", "asaasCustomerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Responsavel_contaId_asaasId_key"
  ON "Responsavel"("contaId", "asaasId");

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_contaId_asaasCustomerId_key"
  ON "Customer"("contaId", "asaasCustomerId");
