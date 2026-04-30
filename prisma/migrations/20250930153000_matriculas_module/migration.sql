-- Enum definitions for new matrícula and cobrança flows
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO', 'BOLETO');
CREATE TYPE "StatusMatricula" AS ENUM ('ATIVA', 'CANCELADA', 'CONCLUIDA');
CREATE TYPE "StatusCobranca" AS ENUM ('PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO', 'ESTORNADO');

-- Matricula adjustments
ALTER TABLE "Matricula" ADD COLUMN "comboId" TEXT;
ALTER TABLE "Matricula" ALTER COLUMN "turmaId" DROP NOT NULL;

-- Garantir que toda matrícula possua um plano antes de tornar o campo obrigatório
UPDATE "Matricula"
SET "planoId" = (
  SELECT "id"
  FROM "Plano"
  ORDER BY "createdAt" NULLS LAST, "id"
  LIMIT 1
)
WHERE "planoId" IS NULL;

ALTER TABLE "Matricula" ALTER COLUMN "planoId" SET NOT NULL;

ALTER TABLE "Matricula" ADD COLUMN "status_tmp" "StatusMatricula" NOT NULL DEFAULT 'ATIVA';
UPDATE "Matricula"
SET "status_tmp" = CASE "status"
  WHEN 'CANCELADA' THEN 'CANCELADA'::"StatusMatricula"
  WHEN 'CONCLUIDA' THEN 'CONCLUIDA'::"StatusMatricula"
  ELSE 'ATIVA'::"StatusMatricula"
END;
ALTER TABLE "Matricula" DROP COLUMN "status";
ALTER TABLE "Matricula" RENAME COLUMN "status_tmp" TO "status";
ALTER TABLE "Matricula" ALTER COLUMN "status" SET DEFAULT 'ATIVA';

CREATE INDEX "idx_matricula_combo" ON "Matricula"("comboId");
CREATE INDEX "idx_matricula_status" ON "Matricula"("status");

ALTER TABLE "Matricula"
  ADD CONSTRAINT "Matricula_comboId_fkey"
  FOREIGN KEY ("comboId")
  REFERENCES "Combo"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Cobranca adjustments
ALTER TABLE "Cobranca" ADD COLUMN "formaPagamento" "FormaPagamento" NOT NULL DEFAULT 'BOLETO';
ALTER TABLE "Cobranca" ADD COLUMN "status_tmp" "StatusCobranca" NOT NULL DEFAULT 'PENDENTE';

UPDATE "Cobranca"
SET "status_tmp" = CASE "status"
  WHEN 'PAGO' THEN 'PAGO'::"StatusCobranca"
  WHEN 'ATRASADO' THEN 'ATRASADO'::"StatusCobranca"
  WHEN 'CANCELADO' THEN 'CANCELADO'::"StatusCobranca"
  WHEN 'ESTORNADO' THEN 'ESTORNADO'::"StatusCobranca"
  ELSE 'PENDENTE'::"StatusCobranca"
END;

UPDATE "Cobranca" SET "competenciaFim" = COALESCE("competenciaFim", "competenciaInicio");

ALTER TABLE "Cobranca" DROP COLUMN "status";
ALTER TABLE "Cobranca" RENAME COLUMN "status_tmp" TO "status";
ALTER TABLE "Cobranca" ALTER COLUMN "status" SET DEFAULT 'PENDENTE';
ALTER TABLE "Cobranca" ALTER COLUMN "competenciaFim" SET NOT NULL;

ALTER TABLE "Cobranca" DROP COLUMN "multa";
ALTER TABLE "Cobranca" DROP COLUMN "juros";
ALTER TABLE "Cobranca" DROP COLUMN "tipo";
