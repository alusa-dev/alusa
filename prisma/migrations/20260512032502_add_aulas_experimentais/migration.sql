-- CreateEnum
CREATE TYPE "AulaExperimentalStatus" AS ENUM ('AGENDADA', 'REAGENDADA', 'REALIZADA', 'CANCELADA');

-- AlterEnum
ALTER TYPE "CalendarEventType" ADD VALUE 'AULA_EXPERIMENTAL';

-- CreateTable
CREATE TABLE "AulaExperimental" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "status" "AulaExperimentalStatus" NOT NULL DEFAULT 'AGENDADA',
    "observacao" TEXT,
    "uiRequestId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AulaExperimental_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AulaExperimental_calendarEventId_key" ON "AulaExperimental"("calendarEventId");

-- CreateIndex
CREATE INDEX "idx_aula_experimental_conta_status_created" ON "AulaExperimental"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_aula_experimental_aluno" ON "AulaExperimental"("alunoId");

-- CreateIndex
CREATE UNIQUE INDEX "AulaExperimental_contaId_uiRequestId_key" ON "AulaExperimental"("contaId", "uiRequestId");

-- AddForeignKey
ALTER TABLE "AulaExperimental" ADD CONSTRAINT "AulaExperimental_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AulaExperimental" ADD CONSTRAINT "AulaExperimental_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AulaExperimental" ADD CONSTRAINT "AulaExperimental_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
