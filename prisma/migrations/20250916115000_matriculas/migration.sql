-- CreateTable
CREATE TABLE "Turma" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "modalidade" TEXT NOT NULL,
    "sala" TEXT,
    "diasSemana" TEXT[],
    "horarioInicio" TEXT NOT NULL,
    "horarioFim" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plano" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimentoDia" INTEGER NOT NULL,
    "frequenciaSemanal" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plano_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matricula" (
    "id" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "planoId" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "taxaMatricula" DECIMAL(12,2),
    "asaasId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matricula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desconto" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "escopo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Desconto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DescontoMatricula" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "descontoId" TEXT NOT NULL,
    "valorFinal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DescontoMatricula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combo" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboTurma" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboTurma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cobranca" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "competenciaInicio" TIMESTAMP(3) NOT NULL,
    "competenciaFim" TIMESTAMP(3),
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "multa" DECIMAL(12,2),
    "juros" DECIMAL(12,2),
    "tipo" TEXT NOT NULL,
    "asaasId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" TEXT NOT NULL,
    "cobrancaId" TEXT NOT NULL,
    "dataPagamento" TIMESTAMP(3),
    "formaPagamento" TEXT NOT NULL,
    "valorPago" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMADO',
    "comprovante" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookAsaas" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',

    CONSTRAINT "WebhookAsaas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_turma_conta" ON "Turma"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Turma_contaId_nome_key" ON "Turma"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_plano_conta" ON "Plano"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Plano_contaId_nome_key" ON "Plano"("contaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Matricula_asaasId_key" ON "Matricula"("asaasId");

-- CreateIndex
CREATE INDEX "idx_matricula_aluno" ON "Matricula"("alunoId");

-- CreateIndex
CREATE INDEX "idx_matricula_turma" ON "Matricula"("turmaId");

-- CreateIndex
CREATE INDEX "idx_matricula_plano" ON "Matricula"("planoId");

-- CreateIndex
CREATE INDEX "idx_desconto_conta" ON "Desconto"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Desconto_contaId_nome_key" ON "Desconto"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_descontomatricula_matricula" ON "DescontoMatricula"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_descontomatricula_desconto" ON "DescontoMatricula"("descontoId");

-- CreateIndex
CREATE UNIQUE INDEX "DescontoMatricula_matriculaId_descontoId_key" ON "DescontoMatricula"("matriculaId", "descontoId");

-- CreateIndex
CREATE INDEX "idx_combo_conta" ON "Combo"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Combo_contaId_nome_key" ON "Combo"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_comboturma_combo" ON "ComboTurma"("comboId");

-- CreateIndex
CREATE INDEX "idx_comboturma_turma" ON "ComboTurma"("turmaId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboTurma_comboId_turmaId_key" ON "ComboTurma"("comboId", "turmaId");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_asaasId_key" ON "Cobranca"("asaasId");

-- CreateIndex
CREATE INDEX "idx_cobranca_matricula" ON "Cobranca"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_cobranca_status" ON "Cobranca"("status");

-- CreateIndex
CREATE INDEX "idx_pagamento_cobranca" ON "Pagamento"("cobrancaId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_conta" ON "WebhookAsaas"("contaId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_status" ON "WebhookAsaas"("status");

-- AddForeignKey
ALTER TABLE "Turma" ADD CONSTRAINT "Turma_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plano" ADD CONSTRAINT "Plano_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desconto" ADD CONSTRAINT "Desconto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DescontoMatricula" ADD CONSTRAINT "DescontoMatricula_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DescontoMatricula" ADD CONSTRAINT "DescontoMatricula_descontoId_fkey" FOREIGN KEY ("descontoId") REFERENCES "Desconto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTurma" ADD CONSTRAINT "ComboTurma_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTurma" ADD CONSTRAINT "ComboTurma_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobranca" ADD CONSTRAINT "Cobranca_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAsaas" ADD CONSTRAINT "WebhookAsaas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

