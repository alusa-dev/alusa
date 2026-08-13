CREATE TYPE "ContratoModeloCampoTipo" AS ENUM ('ASSINATURA', 'RUBRICA');

CREATE TYPE "ContratoModeloCampoPapel" AS ENUM ('ESCOLA', 'RESPONSAVEL_OU_ALUNO');

CREATE TABLE "ContratoModeloCampo" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "tipo" "ContratoModeloCampoTipo" NOT NULL,
    "papel" "ContratoModeloCampoPapel" NOT NULL,
    "pagina" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "largura" DOUBLE PRECISION NOT NULL,
    "altura" DOUBLE PRECISION NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoModeloCampo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_contrato_modelo_campo_conta_modelo_pagina" ON "ContratoModeloCampo"("contaId", "modeloId", "pagina");
CREATE INDEX "idx_contrato_modelo_campo_conta_papel" ON "ContratoModeloCampo"("contaId", "papel");

ALTER TABLE "ContratoModeloCampo" ADD CONSTRAINT "ContratoModeloCampo_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratoModeloCampo" ADD CONSTRAINT "ContratoModeloCampo_modeloId_fkey"
  FOREIGN KEY ("modeloId") REFERENCES "ContratoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
