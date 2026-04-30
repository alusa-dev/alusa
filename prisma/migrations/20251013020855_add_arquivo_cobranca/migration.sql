-- CreateTable
CREATE TABLE "ArquivoCobranca" (
    "id" TEXT NOT NULL,
    "cobrancaId" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArquivoCobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArquivoCobranca_nomeArquivo_key" ON "ArquivoCobranca"("nomeArquivo");

-- CreateIndex
CREATE INDEX "idx_arquivo_cobranca" ON "ArquivoCobranca"("cobrancaId");

-- AddForeignKey
ALTER TABLE "ArquivoCobranca" ADD CONSTRAINT "ArquivoCobranca_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE CASCADE ON UPDATE CASCADE;
