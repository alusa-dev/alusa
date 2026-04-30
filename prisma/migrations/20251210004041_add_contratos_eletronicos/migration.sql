-- CreateEnum
CREATE TYPE "StatusAssinatura" AS ENUM ('PENDENTE', 'ASSINADO', 'EXPIRADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "PortalEvento" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "dataInicio" TIMESTAMP(3) NOT NULL,
    "dataFim" TIMESTAMP(3),
    "local" TEXT,
    "tipo" TEXT,
    "capacidade" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalEventoInscricao" (
    "id" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "qrCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalEventoInscricao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContratoTemplate" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contrato" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "templateId" TEXT,
    "conteudoFinal" TEXT NOT NULL,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "assinadoPor" TEXT,
    "assinadoEmail" TEXT,
    "assinadoCpf" TEXT,
    "assinadoIp" TEXT,
    "assinadoEm" TIMESTAMP(3),
    "assinadoUserAgent" TEXT,
    "hashAssinatura" TEXT,
    "tokenPublico" TEXT NOT NULL,
    "tokenExpiraEm" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "pdfGeradoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalEvento_contaId_idx" ON "PortalEvento"("contaId");

-- CreateIndex
CREATE INDEX "PortalEventoInscricao_eventoId_idx" ON "PortalEventoInscricao"("eventoId");

-- CreateIndex
CREATE INDEX "PortalEventoInscricao_alunoId_idx" ON "PortalEventoInscricao"("alunoId");

-- CreateIndex
CREATE INDEX "idx_contrato_template_conta" ON "ContratoTemplate"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "ContratoTemplate_contaId_nome_key" ON "ContratoTemplate"("contaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Contrato_tokenPublico_key" ON "Contrato"("tokenPublico");

-- CreateIndex
CREATE INDEX "idx_contrato_matricula" ON "Contrato"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_contrato_status" ON "Contrato"("status");

-- CreateIndex
CREATE INDEX "idx_contrato_token" ON "Contrato"("tokenPublico");

-- AddForeignKey
ALTER TABLE "PortalEvento" ADD CONSTRAINT "PortalEvento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalEventoInscricao" ADD CONSTRAINT "PortalEventoInscricao_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "PortalEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalEventoInscricao" ADD CONSTRAINT "PortalEventoInscricao_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoTemplate" ADD CONSTRAINT "ContratoTemplate_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContratoTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
