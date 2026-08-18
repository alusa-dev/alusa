-- O catálogo de templates do sistema deve oferecer somente o consentimento
-- padrão de imagem. Templates de comunicação não fazem parte deste fluxo.

UPDATE "ContratoConsentimentoTemplate"
SET "ativo" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "contaId" IS NULL
  AND "origem" = 'SISTEMA'
  AND NOT ("slug" = 'uso-imagem' AND "versao" = 2 AND "grupoSlug" IS NULL);
