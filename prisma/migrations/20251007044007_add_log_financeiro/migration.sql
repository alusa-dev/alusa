-- CreateTable
CREATE TABLE "LogFinanceiro" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "cobrancaId" TEXT,
    "acao" TEXT NOT NULL,
    "detalhes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogFinanceiro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_conta" ON "LogFinanceiro"("contaId");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_usuario" ON "LogFinanceiro"("usuarioId");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_cobranca" ON "LogFinanceiro"("cobrancaId");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_acao" ON "LogFinanceiro"("acao");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_createdat" ON "LogFinanceiro"("createdAt");

-- AddForeignKey
ALTER TABLE "LogFinanceiro" ADD CONSTRAINT "LogFinanceiro_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogFinanceiro" ADD CONSTRAINT "LogFinanceiro_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogFinanceiro" ADD CONSTRAINT "LogFinanceiro_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE SET NULL ON UPDATE CASCADE;
