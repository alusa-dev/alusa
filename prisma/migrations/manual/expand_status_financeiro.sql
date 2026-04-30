-- AlterEnum: Expandir StatusFinanceiro para estados intermediários
-- ADR: Proteções de Regra de Negócio / Estados Financeiros Explícitos

-- Adicionar novos valores ao enum StatusFinanceiro
ALTER TYPE "StatusFinanceiro" ADD VALUE IF NOT EXISTS 'PENDENTE_FINANCEIRO';
ALTER TYPE "StatusFinanceiro" ADD VALUE IF NOT EXISTS 'SUSPENSO';

-- Nota: Não há migração de dados necessária - valores existentes continuam válidos
-- Novos estados serão usados para casos específicos:
-- - PENDENTE_FINANCEIRO: quando operação financeira está em andamento (ex: criando customer no Asaas)
-- - SUSPENSO: quando cobranças foram temporariamente suspensas (ex: negociação em andamento)
