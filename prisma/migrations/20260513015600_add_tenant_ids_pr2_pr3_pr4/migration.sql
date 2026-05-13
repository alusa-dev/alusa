-- PR2/PR3/PR4: tenant isolation backfills for pivots, matrículas, cobrança and pagamentos.
-- Safety pattern: add nullable columns, backfill, validate, then SET NOT NULL + FK/indexes.

-- Add nullable tenant columns first.
ALTER TABLE "AlunoResponsavel" ADD COLUMN "contaId" TEXT;
ALTER TABLE "TurmaProfessor" ADD COLUMN "contaId" TEXT;
ALTER TABLE "CalendarEventProfessor" ADD COLUMN "contaId" TEXT;
ALTER TABLE "Matricula" ADD COLUMN "contaId" TEXT;
ALTER TABLE "MatriculaTurma" ADD COLUMN "contaId" TEXT;
ALTER TABLE "ComboTurma" ADD COLUMN "contaId" TEXT;
ALTER TABLE "PortalEventoInscricao" ADD COLUMN "contaId" TEXT;
ALTER TABLE "Cobranca" ADD COLUMN "contaId" TEXT;
ALTER TABLE "Pagamento" ADD COLUMN "contaId" TEXT;

-- Backfill from tenant-owned parents.
UPDATE "AlunoResponsavel" ar
SET "contaId" = a."contaId"
FROM "Aluno" a
WHERE ar."alunoId" = a."id";

UPDATE "TurmaProfessor" tp
SET "contaId" = t."contaId"
FROM "Turma" t
WHERE tp."turmaId" = t."id";

UPDATE "CalendarEventProfessor" cep
SET "contaId" = ce."contaId"
FROM "CalendarEvent" ce
WHERE cep."calendarEventId" = ce."id";

UPDATE "Matricula" m
SET "contaId" = a."contaId"
FROM "Aluno" a
WHERE m."alunoId" = a."id";

UPDATE "MatriculaTurma" mt
SET "contaId" = m."contaId"
FROM "Matricula" m
WHERE mt."matriculaId" = m."id";

UPDATE "ComboTurma" ct
SET "contaId" = c."contaId"
FROM "Combo" c
WHERE ct."comboId" = c."id";

UPDATE "PortalEventoInscricao" pei
SET "contaId" = pe."contaId"
FROM "PortalEvento" pe
WHERE pei."eventoId" = pe."id";

UPDATE "Cobranca" c
SET "contaId" = m."contaId"
FROM "Matricula" m
WHERE c."matriculaId" = m."id";

UPDATE "Pagamento" p
SET "contaId" = c."contaId"
FROM "Cobranca" c
WHERE p."cobrancaId" = c."id";

-- Defensive validations: abort migration instead of locking in inconsistent tenant data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AlunoResponsavel" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'AlunoResponsavel.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "AlunoResponsavel" ar
    JOIN "Aluno" a ON a."id" = ar."alunoId"
    JOIN "Responsavel" r ON r."id" = ar."responsavelId"
    WHERE a."contaId" <> r."contaId"
  ) THEN
    RAISE EXCEPTION 'AlunoResponsavel has cross-tenant rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "contaId", "alunoId", "responsavelId", COUNT(*)
      FROM "AlunoResponsavel"
      GROUP BY "contaId", "alunoId", "responsavelId"
      HAVING COUNT(*) > 1
    ) d
  ) THEN
    RAISE EXCEPTION 'AlunoResponsavel has duplicate tenant links';
  END IF;

  IF EXISTS (SELECT 1 FROM "TurmaProfessor" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'TurmaProfessor.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "TurmaProfessor" tp
    JOIN "Turma" t ON t."id" = tp."turmaId"
    JOIN "Professor" p ON p."id" = tp."professorId"
    WHERE t."contaId" <> p."contaId"
  ) THEN
    RAISE EXCEPTION 'TurmaProfessor has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "CalendarEventProfessor" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'CalendarEventProfessor.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CalendarEventProfessor" cep
    JOIN "CalendarEvent" ce ON ce."id" = cep."calendarEventId"
    JOIN "Professor" p ON p."id" = cep."professorId"
    WHERE ce."contaId" <> p."contaId"
  ) THEN
    RAISE EXCEPTION 'CalendarEventProfessor has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "Matricula" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'Matricula.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Matricula" m
    JOIN "Aluno" a ON a."id" = m."alunoId"
    LEFT JOIN "Responsavel" r ON r."id" = m."responsavelFinanceiroId"
    LEFT JOIN "Turma" t ON t."id" = m."turmaId"
    LEFT JOIN "Plano" p ON p."id" = m."planoId"
    LEFT JOIN "Combo" c ON c."id" = m."comboId"
    WHERE a."contaId" <> m."contaId"
       OR (r."id" IS NOT NULL AND r."contaId" <> m."contaId")
       OR (t."id" IS NOT NULL AND t."contaId" <> m."contaId")
       OR (p."id" IS NOT NULL AND p."contaId" <> m."contaId")
       OR (c."id" IS NOT NULL AND c."contaId" <> m."contaId")
  ) THEN
    RAISE EXCEPTION 'Matricula has cross-tenant related rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "MatriculaTurma" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'MatriculaTurma.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "MatriculaTurma" mt
    JOIN "Matricula" m ON m."id" = mt."matriculaId"
    JOIN "Turma" t ON t."id" = mt."turmaId"
    WHERE m."contaId" <> mt."contaId"
       OR t."contaId" <> mt."contaId"
  ) THEN
    RAISE EXCEPTION 'MatriculaTurma has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "ComboTurma" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'ComboTurma.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ComboTurma" ct
    JOIN "Combo" c ON c."id" = ct."comboId"
    JOIN "Turma" t ON t."id" = ct."turmaId"
    WHERE c."contaId" <> ct."contaId"
       OR t."contaId" <> ct."contaId"
  ) THEN
    RAISE EXCEPTION 'ComboTurma has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "PortalEventoInscricao" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'PortalEventoInscricao.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "PortalEventoInscricao" pei
    JOIN "PortalEvento" pe ON pe."id" = pei."eventoId"
    JOIN "Aluno" a ON a."id" = pei."alunoId"
    WHERE pe."contaId" <> pei."contaId"
       OR a."contaId" <> pei."contaId"
  ) THEN
    RAISE EXCEPTION 'PortalEventoInscricao has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "Cobranca" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'Cobranca.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Cobranca" c
    JOIN "Matricula" m ON m."id" = c."matriculaId"
    WHERE c."contaId" <> m."contaId"
  ) THEN
    RAISE EXCEPTION 'Cobranca has cross-tenant rows';
  END IF;

  IF EXISTS (SELECT 1 FROM "Pagamento" WHERE "contaId" IS NULL) THEN
    RAISE EXCEPTION 'Pagamento.contaId backfill left NULL rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Pagamento" p
    JOIN "Cobranca" c ON c."id" = p."cobrancaId"
    WHERE p."contaId" <> c."contaId"
  ) THEN
    RAISE EXCEPTION 'Pagamento has cross-tenant rows';
  END IF;
END $$;

-- Enforce required tenant columns after successful backfill.
ALTER TABLE "AlunoResponsavel" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "TurmaProfessor" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "CalendarEventProfessor" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "Matricula" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "MatriculaTurma" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "ComboTurma" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "PortalEventoInscricao" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "Cobranca" ALTER COLUMN "contaId" SET NOT NULL;
ALTER TABLE "Pagamento" ALTER COLUMN "contaId" SET NOT NULL;

-- Tenant FKs use RESTRICT to avoid deleting tenant-scoped operational/financial history through Conta.
ALTER TABLE "AlunoResponsavel" ADD CONSTRAINT "AlunoResponsavel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TurmaProfessor" ADD CONSTRAINT "TurmaProfessor_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEventProfessor" ADD CONSTRAINT "CalendarEventProfessor_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatriculaTurma" ADD CONSTRAINT "MatriculaTurma_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComboTurma" ADD CONSTRAINT "ComboTurma_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalEventoInscricao" ADD CONSTRAINT "PortalEventoInscricao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Multi-tenant uniques for link tables.
CREATE UNIQUE INDEX "uq_aluno_responsavel_conta_aluno_responsavel" ON "AlunoResponsavel"("contaId", "alunoId", "responsavelId");
CREATE UNIQUE INDEX "uq_turma_professor_conta_turma_professor" ON "TurmaProfessor"("contaId", "turmaId", "professorId");
CREATE UNIQUE INDEX "uq_calendar_event_professor_conta_event_professor" ON "CalendarEventProfessor"("contaId", "calendarEventId", "professorId");
CREATE UNIQUE INDEX "uq_matricula_turma_conta_matricula_turma" ON "MatriculaTurma"("contaId", "matriculaId", "turmaId");
CREATE UNIQUE INDEX "uq_combo_turma_conta_combo_turma" ON "ComboTurma"("contaId", "comboId", "turmaId");
CREATE UNIQUE INDEX "uq_portal_evento_inscricao_conta_evento_aluno" ON "PortalEventoInscricao"("contaId", "eventoId", "alunoId");

-- Tenant-scoped indexes for link tables.
CREATE INDEX "idx_aluno_responsavel_conta_aluno" ON "AlunoResponsavel"("contaId", "alunoId");
CREATE INDEX "idx_aluno_responsavel_conta_responsavel" ON "AlunoResponsavel"("contaId", "responsavelId");
CREATE INDEX "idx_turma_professor_conta_turma" ON "TurmaProfessor"("contaId", "turmaId");
CREATE INDEX "idx_turma_professor_conta_professor" ON "TurmaProfessor"("contaId", "professorId");
CREATE INDEX "idx_calendar_event_professor_conta_event" ON "CalendarEventProfessor"("contaId", "calendarEventId");
CREATE INDEX "idx_calendar_event_professor_conta_professor" ON "CalendarEventProfessor"("contaId", "professorId");
CREATE INDEX "idx_matricula_turma_conta_matricula" ON "MatriculaTurma"("contaId", "matriculaId");
CREATE INDEX "idx_matricula_turma_conta_turma" ON "MatriculaTurma"("contaId", "turmaId");
CREATE INDEX "idx_combo_turma_conta_combo" ON "ComboTurma"("contaId", "comboId");
CREATE INDEX "idx_combo_turma_conta_turma" ON "ComboTurma"("contaId", "turmaId");
CREATE INDEX "idx_portal_evento_inscricao_conta_evento" ON "PortalEventoInscricao"("contaId", "eventoId");
CREATE INDEX "idx_portal_evento_inscricao_conta_aluno" ON "PortalEventoInscricao"("contaId", "alunoId");

-- Tenant-scoped indexes for matrículas and legacy financeiro.
CREATE INDEX "idx_matricula_conta" ON "Matricula"("contaId");
CREATE INDEX "idx_matricula_conta_status" ON "Matricula"("contaId", "status");
CREATE INDEX "idx_matricula_conta_status_financeiro" ON "Matricula"("contaId", "statusFinanceiro");
CREATE INDEX "idx_matricula_conta_aluno" ON "Matricula"("contaId", "alunoId");
CREATE INDEX "idx_matricula_conta_turma" ON "Matricula"("contaId", "turmaId");
CREATE INDEX "idx_matricula_conta_plano" ON "Matricula"("contaId", "planoId");
CREATE INDEX "idx_matricula_conta_combo" ON "Matricula"("contaId", "comboId");
CREATE INDEX "idx_matricula_conta_resp_financeiro" ON "Matricula"("contaId", "responsavelFinanceiroId");
CREATE INDEX "idx_matricula_conta_created" ON "Matricula"("contaId", "createdAt");
CREATE INDEX "idx_matricula_conta_updated" ON "Matricula"("contaId", "updatedAt");

CREATE INDEX "idx_cobranca_conta" ON "Cobranca"("contaId");
CREATE INDEX "idx_cobranca_conta_status" ON "Cobranca"("contaId", "status");
CREATE INDEX "idx_cobranca_conta_status_vencimento" ON "Cobranca"("contaId", "status", "vencimento");
CREATE INDEX "idx_cobranca_conta_vencimento" ON "Cobranca"("contaId", "vencimento");
CREATE INDEX "idx_cobranca_conta_created" ON "Cobranca"("contaId", "createdAt");
CREATE INDEX "idx_cobranca_conta_updated" ON "Cobranca"("contaId", "updatedAt");
CREATE INDEX "idx_cobranca_conta_tipo" ON "Cobranca"("contaId", "tipo");
CREATE INDEX "idx_cobranca_conta_forma" ON "Cobranca"("contaId", "formaPagamento");
CREATE INDEX "idx_cobranca_conta_liquidacao" ON "Cobranca"("contaId", "liquidacaoStatus");
CREATE INDEX "idx_cobranca_conta_asaas_payment" ON "Cobranca"("contaId", "asaasPaymentId");

CREATE INDEX "idx_pagamento_conta" ON "Pagamento"("contaId");
CREATE INDEX "idx_pagamento_conta_status_data" ON "Pagamento"("contaId", "status", "dataPagamento");
CREATE INDEX "idx_pagamento_conta_cobranca" ON "Pagamento"("contaId", "cobrancaId");
CREATE INDEX "idx_pagamento_conta_asaas_payment" ON "Pagamento"("contaId", "asaasPaymentId");
CREATE INDEX "idx_pagamento_conta_created" ON "Pagamento"("contaId", "createdAt");
