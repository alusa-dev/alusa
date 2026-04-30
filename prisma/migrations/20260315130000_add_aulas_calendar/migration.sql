DO $$
BEGIN
  CREATE TYPE "CalendarEventType" AS ENUM (
    'AULA',
    'REPOSICAO',
    'EVENTO_INTERNO',
    'EVENTO_EXTERNO',
    'WORKSHOP',
    'FERIADO',
    'PAUSA',
    'CANCELAMENTO',
    'SUBSTITUICAO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CalendarEventStatus" AS ENUM ('AGENDADO', 'CANCELADO', 'REALIZADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM (
    'PRESENTE',
    'FALTA',
    'FALTA_JUSTIFICADA',
    'ATRASO',
    'REPOSICAO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MakeupClassStatus" AS ENUM ('AGENDADA', 'REALIZADA', 'CANCELADA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MakeupClassScope" AS ENUM ('INDIVIDUAL', 'COLETIVA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CalendarEvent" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipo" "CalendarEventType" NOT NULL,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'AGENDADO',
    "source" TEXT,
    "sourceRuleKey" TEXT,
    "manuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "turmaId" TEXT,
    "salaId" TEXT,
    "externalProvider" TEXT,
    "externalEventId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CalendarEventProfessor" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "professorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventProfessor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "matriculaId" TEXT,
    "status" "AttendanceStatus" NOT NULL,
    "observacao" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MakeupClass" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "scope" "MakeupClassScope" NOT NULL DEFAULT 'INDIVIDUAL',
    "alunoId" TEXT,
    "matriculaId" TEXT,
    "eventoOrigemId" TEXT NOT NULL,
    "eventoDestinoId" TEXT NOT NULL,
    "turmaOrigemId" TEXT NOT NULL,
    "turmaDestinoId" TEXT NOT NULL,
    "status" "MakeupClassStatus" NOT NULL DEFAULT 'AGENDADA',
    "observacao" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakeupClass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_calendar_event_source_rule_start" ON "CalendarEvent"("contaId", "sourceRuleKey", "startAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_calendar_event_external" ON "CalendarEvent"("contaId", "externalProvider", "externalEventId");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_conta_start" ON "CalendarEvent"("contaId", "startAt");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_conta_end" ON "CalendarEvent"("contaId", "endAt");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_conta_tipo_status" ON "CalendarEvent"("contaId", "tipo", "status");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_turma_start" ON "CalendarEvent"("turmaId", "startAt");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_sala_start" ON "CalendarEvent"("salaId", "startAt");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_calendar_event_professor" ON "CalendarEventProfessor"("calendarEventId", "professorId");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_professor_event" ON "CalendarEventProfessor"("calendarEventId");
CREATE INDEX IF NOT EXISTS "idx_calendar_event_professor_professor" ON "CalendarEventProfessor"("professorId");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_attendance_event_aluno" ON "AttendanceRecord"("calendarEventId", "alunoId");
CREATE INDEX IF NOT EXISTS "idx_attendance_conta_recorded" ON "AttendanceRecord"("contaId", "recordedAt");
CREATE INDEX IF NOT EXISTS "idx_attendance_event" ON "AttendanceRecord"("calendarEventId");
CREATE INDEX IF NOT EXISTS "idx_attendance_aluno" ON "AttendanceRecord"("alunoId");
CREATE INDEX IF NOT EXISTS "idx_attendance_matricula" ON "AttendanceRecord"("matriculaId");

CREATE INDEX IF NOT EXISTS "idx_makeup_class_conta_created" ON "MakeupClass"("contaId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_aluno" ON "MakeupClass"("alunoId");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_matricula" ON "MakeupClass"("matriculaId");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_evento_origem" ON "MakeupClass"("eventoOrigemId");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_evento_destino" ON "MakeupClass"("eventoDestinoId");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_turma_origem" ON "MakeupClass"("turmaOrigemId");
CREATE INDEX IF NOT EXISTS "idx_makeup_class_turma_destino" ON "MakeupClass"("turmaDestinoId");

DO $$
BEGIN
  ALTER TABLE "CalendarEvent"
    ADD CONSTRAINT "CalendarEvent_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CalendarEvent"
    ADD CONSTRAINT "CalendarEvent_turmaId_fkey"
    FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CalendarEvent"
    ADD CONSTRAINT "CalendarEvent_salaId_fkey"
    FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CalendarEventProfessor"
    ADD CONSTRAINT "CalendarEventProfessor_calendarEventId_fkey"
    FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CalendarEventProfessor"
    ADD CONSTRAINT "CalendarEventProfessor_professorId_fkey"
    FOREIGN KEY ("professorId") REFERENCES "Professor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceRecord"
    ADD CONSTRAINT "AttendanceRecord_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceRecord"
    ADD CONSTRAINT "AttendanceRecord_calendarEventId_fkey"
    FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceRecord"
    ADD CONSTRAINT "AttendanceRecord_alunoId_fkey"
    FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceRecord"
    ADD CONSTRAINT "AttendanceRecord_matriculaId_fkey"
    FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AttendanceRecord"
    ADD CONSTRAINT "AttendanceRecord_recordedByUserId_fkey"
    FOREIGN KEY ("recordedByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_alunoId_fkey"
    FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_matriculaId_fkey"
    FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_eventoOrigemId_fkey"
    FOREIGN KEY ("eventoOrigemId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_eventoDestinoId_fkey"
    FOREIGN KEY ("eventoDestinoId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_turmaOrigemId_fkey"
    FOREIGN KEY ("turmaOrigemId") REFERENCES "Turma"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_turmaDestinoId_fkey"
    FOREIGN KEY ("turmaDestinoId") REFERENCES "Turma"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "MakeupClass"
    ADD CONSTRAINT "MakeupClass_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
