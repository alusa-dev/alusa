-- CreateTable
CREATE TABLE "ArquivoCharge" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArquivoCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArquivoCharge_nomeArquivo_key" ON "ArquivoCharge"("nomeArquivo");

-- CreateIndex
CREATE INDEX "ArquivoCharge_chargeId_idx" ON "ArquivoCharge"("chargeId");

-- AddForeignKey
ALTER TABLE "ArquivoCharge" ADD CONSTRAINT "ArquivoCharge_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
