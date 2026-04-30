-- Impede corrida criando múltiplos contratos PENDENTES para a mesma matrícula
-- (permitindo histórico de contratos ASSINADOS)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_contrato_matricula_pendente"
  ON "Contrato" ("matriculaId")
  WHERE "status" = 'PENDENTE';
