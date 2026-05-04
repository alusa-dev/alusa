-- CreateEnum
CREATE TYPE "FamilyBillingStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'ATIVO', 'PARCIAL', 'FALHO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "FamilyBillingOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "familyGroupId" TEXT;

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "matriculaFamiliarId" TEXT;

-- AlterTable
ALTER TABLE "StandaloneInstallmentPlan" ADD COLUMN     "familyGroupId" TEXT;

-- AlterTable
ALTER TABLE "StandaloneSubscription" ADD COLUMN     "familyGroupId" TEXT;

-- CreateTable
CREATE TABLE "MatriculaFamiliar" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "billingMode" "BillingMode" NOT NULL DEFAULT 'SHARED_PLAN',
    "status" "FamilyBillingStatus" NOT NULL DEFAULT 'PENDENTE',
    "totalAlunos" INTEGER NOT NULL DEFAULT 0,
    "valorMensalidadeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorTaxaMatriculaTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "formaPagamento" TEXT,
    "ciclo" TEXT,
    "diaVencimento" INTEGER,
    "dataInicio" TIMESTAMP(3),
    "dataFimContrato" TIMESTAMP(3),
    "standaloneSubscriptionId" TEXT,
    "standaloneEnrollmentChargeId" TEXT,
    "ultimoErro" TEXT,
    "actorId" TEXT,
    "uiRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatriculaFamiliar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatriculaFamiliarItem" (
    "id" TEXT NOT NULL,
    "matriculaFamiliarId" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatriculaFamiliarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RematriculaFamiliar" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "billingMode" "BillingMode" NOT NULL DEFAULT 'SHARED_PLAN',
    "status" "FamilyBillingStatus" NOT NULL DEFAULT 'PENDENTE',
    "totalAlunos" INTEGER NOT NULL DEFAULT 0,
    "valorMensalidadeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorTaxaMatriculaTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "formaPagamento" TEXT,
    "ciclo" TEXT,
    "diaVencimento" INTEGER,
    "dataInicio" TIMESTAMP(3),
    "dataFimContrato" TIMESTAMP(3),
    "standaloneSubscriptionId" TEXT,
    "standaloneEnrollmentChargeId" TEXT,
    "ultimoErro" TEXT,
    "actorId" TEXT,
    "uiRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RematriculaFamiliar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RematriculaFamiliarItem" (
    "id" TEXT NOT NULL,
    "rematriculaFamiliarId" TEXT NOT NULL,
    "matriculaOrigemId" TEXT NOT NULL,
    "novaMatriculaId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RematriculaFamiliarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyBillingOutbox" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FamilyBillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "matriculaFamiliarId" TEXT,
    "rematriculaFamiliarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyBillingOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_conta" ON "MatriculaFamiliar"("contaId");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_responsavel" ON "MatriculaFamiliar"("responsavelId");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_status" ON "MatriculaFamiliar"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MatriculaFamiliar_contaId_uiRequestId_key" ON "MatriculaFamiliar"("contaId", "uiRequestId");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_item_matricula" ON "MatriculaFamiliarItem"("matriculaId");

-- CreateIndex
CREATE UNIQUE INDEX "MatriculaFamiliarItem_matriculaFamiliarId_matriculaId_key" ON "MatriculaFamiliarItem"("matriculaFamiliarId", "matriculaId");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_conta" ON "RematriculaFamiliar"("contaId");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_responsavel" ON "RematriculaFamiliar"("responsavelId");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_status" ON "RematriculaFamiliar"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RematriculaFamiliar_contaId_uiRequestId_key" ON "RematriculaFamiliar"("contaId", "uiRequestId");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_item_origem" ON "RematriculaFamiliarItem"("matriculaOrigemId");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_item_nova" ON "RematriculaFamiliarItem"("novaMatriculaId");

-- CreateIndex
CREATE UNIQUE INDEX "RematriculaFamiliarItem_rematriculaFamiliarId_matriculaOrig_key" ON "RematriculaFamiliarItem"("rematriculaFamiliarId", "matriculaOrigemId");

-- CreateIndex
CREATE INDEX "idx_family_billing_outbox_queue" ON "FamilyBillingOutbox"("contaId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "idx_family_billing_outbox_matricula" ON "FamilyBillingOutbox"("matriculaFamiliarId");

-- CreateIndex
CREATE INDEX "idx_family_billing_outbox_rematricula" ON "FamilyBillingOutbox"("rematriculaFamiliarId");

-- CreateIndex
CREATE INDEX "Charge_familyGroupId_idx" ON "Charge"("familyGroupId");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar" ON "Matricula"("matriculaFamiliarId");

-- CreateIndex
CREATE INDEX "StandaloneInstallmentPlan_familyGroupId_idx" ON "StandaloneInstallmentPlan"("familyGroupId");

-- CreateIndex
CREATE INDEX "StandaloneSubscription_familyGroupId_idx" ON "StandaloneSubscription"("familyGroupId");

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_matriculaFamiliarId_fkey" FOREIGN KEY ("matriculaFamiliarId") REFERENCES "MatriculaFamiliar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaFamiliar" ADD CONSTRAINT "MatriculaFamiliar_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaFamiliar" ADD CONSTRAINT "MatriculaFamiliar_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaFamiliarItem" ADD CONSTRAINT "MatriculaFamiliarItem_matriculaFamiliarId_fkey" FOREIGN KEY ("matriculaFamiliarId") REFERENCES "MatriculaFamiliar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaFamiliarItem" ADD CONSTRAINT "MatriculaFamiliarItem_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaFamiliar" ADD CONSTRAINT "RematriculaFamiliar_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaFamiliar" ADD CONSTRAINT "RematriculaFamiliar_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaFamiliarItem" ADD CONSTRAINT "RematriculaFamiliarItem_rematriculaFamiliarId_fkey" FOREIGN KEY ("rematriculaFamiliarId") REFERENCES "RematriculaFamiliar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaFamiliarItem" ADD CONSTRAINT "RematriculaFamiliarItem_matriculaOrigemId_fkey" FOREIGN KEY ("matriculaOrigemId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaFamiliarItem" ADD CONSTRAINT "RematriculaFamiliarItem_novaMatriculaId_fkey" FOREIGN KEY ("novaMatriculaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyBillingOutbox" ADD CONSTRAINT "FamilyBillingOutbox_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyBillingOutbox" ADD CONSTRAINT "FamilyBillingOutbox_matriculaFamiliarId_fkey" FOREIGN KEY ("matriculaFamiliarId") REFERENCES "MatriculaFamiliar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyBillingOutbox" ADD CONSTRAINT "FamilyBillingOutbox_rematriculaFamiliarId_fkey" FOREIGN KEY ("rematriculaFamiliarId") REFERENCES "RematriculaFamiliar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

