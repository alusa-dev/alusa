-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "OrigemLancamento" AS ENUM ('SISTEMA', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusLancamento" AS ENUM ('RECEBIDO', 'PREVISTO', 'PAGO', 'PENDENTE', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "FormaPagamentoLancamento" AS ENUM ('PIX', 'BOLETO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'TRANSFERENCIA', 'TED', 'DOC', 'DEBITO_AUTOMATICO', 'CHEQUE', 'VOUCHER', 'OUTRO');

-- CreateTable
CREATE TABLE "CategoriaLancamento" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoriaLancamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lancamento" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "origem" "OrigemLancamento" NOT NULL,
    "status" "StatusLancamento" NOT NULL,
    "valor" DECIMAL(14, 2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "referencia" TEXT,
    "categoriaId" TEXT,
    "subcategoriaId" TEXT,
    "formaPagamento" "FormaPagamentoLancamento",
    "dataEfetiva" TIMESTAMP(3),
    "dataPrevista" TIMESTAMP(3),
    "isEstorno" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "dataEstorno" TIMESTAMP(3),
    "motivoEstorno" TEXT,
    "observacao" TEXT,
    "anexoUrl" TEXT,
    "externalRef" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lancamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_categoria_lancamento_nome_tipo_parent" ON "CategoriaLancamento"("contaId", "nome", "tipo", "parentId");

-- CreateIndex
CREATE INDEX "idx_categoria_lancamento_conta_tipo" ON "CategoriaLancamento"("contaId", "tipo");

-- CreateIndex
CREATE INDEX "idx_lancamento_conta_tipo_status" ON "Lancamento"("contaId", "tipo", "status");

-- CreateIndex
CREATE INDEX "idx_lancamento_conta_data" ON "Lancamento"("contaId", "dataEfetiva");

-- CreateIndex
CREATE INDEX "idx_lancamento_external_ref" ON "Lancamento"("externalRef");

-- AddForeignKey
ALTER TABLE "CategoriaLancamento" ADD CONSTRAINT "CategoriaLancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaLancamento" ADD CONSTRAINT "CategoriaLancamento_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CategoriaLancamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaLancamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_subcategoriaId_fkey" FOREIGN KEY ("subcategoriaId") REFERENCES "CategoriaLancamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Lancamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
