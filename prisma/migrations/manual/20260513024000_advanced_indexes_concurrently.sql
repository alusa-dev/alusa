-- Operational migration: run outside Prisma Migrate because CREATE INDEX
-- CONCURRENTLY cannot run inside Prisma's shadow-database transaction.
-- Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Search paths using contains + insensitive on operational listing screens.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_aluno_nome_trgm"
ON "Aluno" USING GIN ("nome" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_responsavel_nome_trgm"
ON "Responsavel" USING GIN ("nome" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_professor_nome_trgm"
ON "Professor" USING GIN ("nome" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_turma_nome_trgm"
ON "Turma" USING GIN ("nome" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_product_name_trgm"
ON "Product" USING GIN ("name" gin_trgm_ops);

-- Array filters used in class scheduling conflict checks.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_turma_dias_semana_gin"
ON "Turma" USING GIN ("diasSemana");
