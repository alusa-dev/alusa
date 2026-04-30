-- CreateEnum
CREATE TYPE "CentroCustoTipo" AS ENUM ('RECEITA', 'DESPESA', 'MISTO');

-- CreateTable
CREATE TABLE "CentroCusto" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "CentroCustoTipo" NOT NULL,
    "descricao" TEXT,
    "status" "Status" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CentroCusto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_centrocusto_nome_tipo_conta" ON "CentroCusto"("contaId", "nome", "tipo");

-- CreateIndex
CREATE INDEX "idx_centrocusto_conta_tipo" ON "CentroCusto"("contaId", "tipo");

-- AlterTable
ALTER TABLE "Lancamento" ADD COLUMN     "centroCustoId" TEXT;

-- CreateIndex
CREATE INDEX "idx_lancamento_conta_centro" ON "Lancamento"("contaId", "centroCustoId");

-- AddForeignKey
ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_centroCustoId_fkey" FOREIGN KEY ("centroCustoId") REFERENCES "CentroCusto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
