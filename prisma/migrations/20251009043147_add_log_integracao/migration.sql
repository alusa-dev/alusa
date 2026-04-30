-- CreateTable
CREATE TABLE "LogIntegracao" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipoOperacao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "asaasId" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "request" JSONB,
    "response" JSONB,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogIntegracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_logintegracao_conta_tipo" ON "LogIntegracao"("contaId", "tipoOperacao");

-- CreateIndex
CREATE INDEX "idx_logintegracao_entidade" ON "LogIntegracao"("entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "idx_logintegracao_status" ON "LogIntegracao"("status");

-- CreateIndex
CREATE INDEX "idx_logintegracao_createdat" ON "LogIntegracao"("createdAt");

-- CreateIndex
CREATE INDEX "idx_logintegracao_asaasid" ON "LogIntegracao"("asaasId");

-- AddForeignKey
ALTER TABLE "LogIntegracao" ADD CONSTRAINT "LogIntegracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
