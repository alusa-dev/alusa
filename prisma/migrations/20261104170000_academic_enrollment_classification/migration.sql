CREATE TYPE "ClassificacaoAcademica" AS ENUM (
  'PRIMEIRO_INGRESSO', 'REMATRICULA', 'RETORNO', 'TRANSFERENCIA', 'HISTORICO_INDETERMINADO'
);
CREATE TYPE "OrigemClassificacaoAcademica" AS ENUM ('AUTOMATICA', 'MANUAL_ADMIN', 'TRANSFERENCIA_FORMAL');

CREATE UNIQUE INDEX "uq_modalidade_conta_id" ON "Modalidade"("contaId", "id");

CREATE TABLE "CicloAcademico" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "modalidadeId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "sequencia" INTEGER NOT NULL,
  "dataInicio" TIMESTAMP(3) NOT NULL,
  "dataFim" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CicloAcademico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_ciclo_academico_conta_id" ON "CicloAcademico"("contaId", "id");
CREATE UNIQUE INDEX "uq_ciclo_academico_conta_modalidade_id" ON "CicloAcademico"("contaId", "modalidadeId", "id");
CREATE UNIQUE INDEX "uq_ciclo_academico_conta_modalidade_sequencia" ON "CicloAcademico"("contaId", "modalidadeId", "sequencia");
CREATE INDEX "idx_ciclo_academico_conta_modalidade_datas" ON "CicloAcademico"("contaId", "modalidadeId", "dataInicio", "dataFim");
ALTER TABLE "CicloAcademico" ADD CONSTRAINT "CicloAcademico_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CicloAcademico" ADD CONSTRAINT "CicloAcademico_contaId_modalidadeId_fkey" FOREIGN KEY ("contaId", "modalidadeId") REFERENCES "Modalidade"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CicloAcademico" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CicloAcademico" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "Turma" ADD COLUMN "cicloAcademicoId" TEXT;
CREATE INDEX "idx_turma_conta_ciclo" ON "Turma"("contaId", "cicloAcademicoId");
ALTER TABLE "Turma" ADD CONSTRAINT "Turma_contaId_modalidadeId_cicloAcademicoId_fkey" FOREIGN KEY ("contaId", "modalidadeId", "cicloAcademicoId") REFERENCES "CicloAcademico"("contaId", "modalidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MatriculaVinculoAcademico" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "matriculaId" TEXT NOT NULL,
  "modalidadeId" TEXT NOT NULL,
  "cicloAcademicoId" TEXT,
  "classificacao" "ClassificacaoAcademica" NOT NULL DEFAULT 'HISTORICO_INDETERMINADO',
  "classificacaoMotivo" TEXT,
  "classificacaoDefinidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatriculaVinculoAcademico_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_matricula_vinculo_academico_conta_matricula_modalidade" ON "MatriculaVinculoAcademico"("contaId", "matriculaId", "modalidadeId");
CREATE INDEX "idx_matricula_vinculo_academico_curso_ciclo" ON "MatriculaVinculoAcademico"("contaId", "modalidadeId", "cicloAcademicoId");
ALTER TABLE "MatriculaVinculoAcademico" ADD CONSTRAINT "MatriculaVinculoAcademico_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademico" ADD CONSTRAINT "MatriculaVinculoAcademico_contaId_matriculaId_fkey" FOREIGN KEY ("contaId", "matriculaId") REFERENCES "Matricula"("contaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademico" ADD CONSTRAINT "MatriculaVinculoAcademico_contaId_modalidadeId_fkey" FOREIGN KEY ("contaId", "modalidadeId") REFERENCES "Modalidade"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademico" ADD CONSTRAINT "MatriculaVinculoAcademico_contaId_modalidadeId_cicloAcademicoId_fkey" FOREIGN KEY ("contaId", "modalidadeId", "cicloAcademicoId") REFERENCES "CicloAcademico"("contaId", "modalidadeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaVinculoAcademico" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MatriculaVinculoAcademico" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "CicloAcademico"
  ADD CONSTRAINT "CicloAcademico_datas_validas_check" CHECK ("dataFim" >= "dataInicio");

ALTER TABLE "MatriculaVinculoAcademico" ADD COLUMN "vigenciaIniciadaEm" TIMESTAMP(3);
ALTER TABLE "MatriculaVinculoAcademico" ADD COLUMN "classificacaoOrigem" "OrigemClassificacaoAcademica" NOT NULL DEFAULT 'AUTOMATICA';
CREATE UNIQUE INDEX "uq_matricula_vinculo_academico_conta_id" ON "MatriculaVinculoAcademico"("contaId", "id");

CREATE TABLE "HistoricoAcademicoCobertura" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "modalidadeId" TEXT NOT NULL,
  "coberturaDesde" TIMESTAMP(3) NOT NULL,
  "revisadoPor" TEXT NOT NULL,
  "revisadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "motivo" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoricoAcademicoCobertura_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_historico_academico_cobertura_curso" ON "HistoricoAcademicoCobertura"("contaId", "modalidadeId");
ALTER TABLE "HistoricoAcademicoCobertura" ADD CONSTRAINT "HistoricoAcademicoCobertura_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricoAcademicoCobertura" ADD CONSTRAINT "HistoricoAcademicoCobertura_contaId_modalidadeId_fkey" FOREIGN KEY ("contaId", "modalidadeId") REFERENCES "Modalidade"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricoAcademicoCobertura" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HistoricoAcademicoCobertura" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

CREATE TABLE "MatriculaClassificacaoAudit" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "vinculoAcademicoId" TEXT NOT NULL,
  "de" "ClassificacaoAcademica" NOT NULL,
  "para" "ClassificacaoAcademica" NOT NULL,
  "motivo" TEXT NOT NULL,
  "autorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatriculaClassificacaoAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_classificacao_audit_vinculo" ON "MatriculaClassificacaoAudit"("contaId", "vinculoAcademicoId", "createdAt");
ALTER TABLE "MatriculaClassificacaoAudit" ADD CONSTRAINT "MatriculaClassificacaoAudit_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaClassificacaoAudit" ADD CONSTRAINT "MatriculaClassificacaoAudit_contaId_vinculoAcademicoId_fkey" FOREIGN KEY ("contaId", "vinculoAcademicoId") REFERENCES "MatriculaVinculoAcademico"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaClassificacaoAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MatriculaClassificacaoAudit" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

CREATE TABLE "TransferenciaAcademicaVinculo" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "origemVinculoId" TEXT NOT NULL,
  "destinoVinculoId" TEXT NOT NULL,
  "motivo" TEXT NOT NULL,
  "formalizadaEm" TIMESTAMP(3) NOT NULL,
  "formalizadaPor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransferenciaAcademicaVinculo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TransferenciaAcademicaVinculo_origemVinculoId_key" ON "TransferenciaAcademicaVinculo"("origemVinculoId");
CREATE UNIQUE INDEX "TransferenciaAcademicaVinculo_destinoVinculoId_key" ON "TransferenciaAcademicaVinculo"("destinoVinculoId");
CREATE UNIQUE INDEX "uq_transferencia_academica_origem" ON "TransferenciaAcademicaVinculo"("contaId", "origemVinculoId");
CREATE UNIQUE INDEX "uq_transferencia_academica_destino" ON "TransferenciaAcademicaVinculo"("contaId", "destinoVinculoId");
CREATE INDEX "idx_transferencia_academica_conta_data" ON "TransferenciaAcademicaVinculo"("contaId", "formalizadaEm");
ALTER TABLE "TransferenciaAcademicaVinculo" ADD CONSTRAINT "TransferenciaAcademicaVinculo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferenciaAcademicaVinculo" ADD CONSTRAINT "TransferenciaAcademicaVinculo_contaId_origemVinculoId_fkey" FOREIGN KEY ("contaId", "origemVinculoId") REFERENCES "MatriculaVinculoAcademico"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferenciaAcademicaVinculo" ADD CONSTRAINT "TransferenciaAcademicaVinculo_contaId_destinoVinculoId_fkey" FOREIGN KEY ("contaId", "destinoVinculoId") REFERENCES "MatriculaVinculoAcademico"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransferenciaAcademicaVinculo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TransferenciaAcademicaVinculo" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

CREATE TABLE "HistoricoAcademicoCoberturaAudit" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "modalidadeId" TEXT NOT NULL,
  "coberturaDesdeAnterior" TIMESTAMP(3),
  "coberturaDesdeNova" TIMESTAMP(3) NOT NULL,
  "motivo" TEXT NOT NULL,
  "autorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricoAcademicoCoberturaAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_historico_cobertura_audit_curso" ON "HistoricoAcademicoCoberturaAudit"("contaId", "modalidadeId", "createdAt");
ALTER TABLE "HistoricoAcademicoCoberturaAudit" ADD CONSTRAINT "HistoricoAcademicoCoberturaAudit_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricoAcademicoCoberturaAudit" ADD CONSTRAINT "HistoricoAcademicoCoberturaAudit_contaId_modalidadeId_fkey" FOREIGN KEY ("contaId", "modalidadeId") REFERENCES "Modalidade"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricoAcademicoCoberturaAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HistoricoAcademicoCoberturaAudit" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

