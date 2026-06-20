-- Remove o caminho legado de rematrícula em duas fases.
-- O fluxo canônico passa a ser RematriculaProcesso/RematriculaItem.

DROP TABLE IF EXISTS "RematriculaOperacao" CASCADE;
DROP TYPE IF EXISTS "RematriculaOperacaoStep";
DROP TYPE IF EXISTS "RematriculaOperacaoStatus";
