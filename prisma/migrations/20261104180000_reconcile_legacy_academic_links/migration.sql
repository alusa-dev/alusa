-- Historical class membership proves course membership, but not cycle or
-- official activation date. Materialize a reviewable indeterminate snapshot.
-- Deterministic IDs plus the unique key make the backfill idempotent.
DO $$ BEGIN
  CREATE TYPE "OrigemClassificacaoAcademica" AS ENUM ('AUTOMATICA', 'MANUAL_ADMIN', 'TRANSFERENCIA_FORMAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "MatriculaVinculoAcademico" ADD COLUMN IF NOT EXISTS "vigenciaIniciadaEm" TIMESTAMP(3);
ALTER TABLE "MatriculaVinculoAcademico" ADD COLUMN IF NOT EXISTS "classificacaoOrigem" "OrigemClassificacaoAcademica" NOT NULL DEFAULT 'AUTOMATICA';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_matricula_vinculo_academico_conta_id" ON "MatriculaVinculoAcademico"("contaId", "id");
WITH historical_course_memberships AS (
  SELECT DISTINCT mt."contaId", mt."matriculaId", t."modalidadeId"
  FROM "MatriculaTurma" mt
  JOIN "Turma" t ON t."contaId" = mt."contaId" AND t."id" = mt."turmaId"
  UNION
  SELECT DISTINCT m."contaId", m."id" AS "matriculaId", t."modalidadeId"
  FROM "Matricula" m
  JOIN "Turma" t ON t."contaId" = m."contaId" AND t."id" = m."turmaId"
)
INSERT INTO "MatriculaVinculoAcademico" (
  "id", "contaId", "matriculaId", "modalidadeId", "cicloAcademicoId",
  "vigenciaIniciadaEm", "classificacao", "classificacaoOrigem",
  "classificacaoMotivo", "classificacaoDefinidaEm", "createdAt", "updatedAt"
)
SELECT
  'legacy-academic-' || md5(hcm."contaId" || ':' || hcm."matriculaId" || ':' || hcm."modalidadeId"),
  hcm."contaId", hcm."matriculaId", hcm."modalidadeId", NULL, NULL,
  'HISTORICO_INDETERMINADO'::"ClassificacaoAcademica",
  'AUTOMATICA'::"OrigemClassificacaoAcademica",
  'HISTORICO_PRE_MIGRACAO_NAO_RECONSTRUIDO', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM historical_course_memberships hcm
ON CONFLICT ("contaId", "matriculaId", "modalidadeId") DO NOTHING;

CREATE TABLE "MatriculaVinculoAcademicoAudit" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "vinculoAcademicoId" TEXT NOT NULL,
  "cicloAcademicoIdAnterior" TEXT,
  "cicloAcademicoIdNovo" TEXT,
  "vigenciaIniciadaEmAnterior" TIMESTAMP(3),
  "vigenciaIniciadaEmNova" TIMESTAMP(3),
  "motivo" TEXT NOT NULL,
  "autorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatriculaVinculoAcademicoAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_vinculo_academico_audit_link" ON "MatriculaVinculoAcademicoAudit"("contaId", "vinculoAcademicoId", "createdAt");
ALTER TABLE "MatriculaVinculoAcademicoAudit" ADD CONSTRAINT "MatriculaVinculoAcademicoAudit_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademicoAudit" ADD CONSTRAINT "MatriculaVinculoAcademicoAudit_contaId_vinculoAcademicoId_fkey" FOREIGN KEY ("contaId", "vinculoAcademicoId") REFERENCES "MatriculaVinculoAcademico"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademicoAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MatriculaVinculoAcademicoAudit" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());
