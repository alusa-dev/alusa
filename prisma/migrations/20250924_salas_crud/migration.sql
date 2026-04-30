-- Migration: 20250924_salas_crud
-- Ajusta modelo Sala conforme nova especificação

-- Adiciona coluna descricao
ALTER TABLE "Sala" ADD COLUMN IF NOT EXISTS "descricao" TEXT;

-- Ajusta status para usar enum Status (assumindo valores atuais 'ATIVA'/'INATIVA')
UPDATE "Sala" SET "status" = 'ATIVO' WHERE "status" IN ('ATIVA');
UPDATE "Sala" SET "status" = 'INATIVO' WHERE "status" = 'INATIVA';

-- Torna capacidade NOT NULL definindo default temporário
UPDATE "Sala" SET "capacidade" = 0 WHERE "capacidade" IS NULL;
ALTER TABLE "Sala" ALTER COLUMN "capacidade" SET NOT NULL;

-- Nenhuma mudança adicional de índices necessária.
