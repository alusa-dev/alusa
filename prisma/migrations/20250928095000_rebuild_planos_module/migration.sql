-- Rebuild Plano module
-- Drops legacy Plano table and recreates with new schema aligned to Status enum and clean relations

-- Drop existing foreign key from Matricula to Plano (if exists)
ALTER TABLE "Matricula" DROP CONSTRAINT IF EXISTS "Matricula_planoId_fkey";

-- Drop legacy Plano table
DROP TABLE IF EXISTS "Plano";

-- Create new Plano table
CREATE TABLE "Plano" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "periodicidade" "PeriodicidadePlano" NOT NULL DEFAULT 'MENSAL',
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plano_pkey" PRIMARY KEY ("id")
);

-- Indexes & constraints
CREATE UNIQUE INDEX "uq_plano_conta_nome" ON "Plano" ("contaId", "nome");
CREATE INDEX "idx_plano_conta" ON "Plano" ("contaId");

-- Recreate foreign key from Matricula.planoId to Plano.id with SET NULL on delete
ALTER TABLE "Matricula"
    ADD CONSTRAINT "Matricula_planoId_fkey"
    FOREIGN KEY ("planoId")
    REFERENCES "Plano"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- Ajusta enum PeriodicidadePlano removendo valores legados não suportados pelo novo módulo de Planos.
-- Substitui valores antigos por TRIMESTRAL antes de recriar o enum.

DO $$
BEGIN
  UPDATE "Plano"
  SET "periodicidade" = 'TRIMESTRAL'
  WHERE "periodicidade"::text IN ('QUINZENAL', 'SEMANAL');
END$$;

ALTER TABLE "Plano" ALTER COLUMN "periodicidade" DROP DEFAULT;

ALTER TYPE "PeriodicidadePlano" RENAME TO "PeriodicidadePlano_old";
CREATE TYPE "PeriodicidadePlano" AS ENUM ('MENSAL', 'TRIMESTRAL', 'ANUAL');
ALTER TABLE "Plano"
  ALTER COLUMN "periodicidade" TYPE "PeriodicidadePlano"
  USING ("periodicidade"::text::"PeriodicidadePlano");
ALTER TABLE "Plano" ALTER COLUMN "periodicidade" SET DEFAULT 'MENSAL';
DROP TYPE "PeriodicidadePlano_old";
