-- Migration: modalidades_crud
-- Garante a existência da tabela Modalidade (legada) e adiciona coluna descricao

CREATE TABLE IF NOT EXISTS "Modalidade" (
	"id"        TEXT      PRIMARY KEY,
	"contaId"   TEXT      NOT NULL REFERENCES "Conta"("id") ON DELETE CASCADE,
	"nome"      TEXT      NOT NULL,
	"descricao" TEXT,
	"status"    TEXT      NOT NULL DEFAULT 'ATIVO',
	"createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_modalidade_conta_nome" ON "Modalidade"("contaId", "nome");
CREATE INDEX IF NOT EXISTS "idx_modalidade_conta" ON "Modalidade"("contaId");

ALTER TABLE "Modalidade" ADD COLUMN IF NOT EXISTS "descricao" TEXT;

-- (Soft delete já modelado via status INATIVO)