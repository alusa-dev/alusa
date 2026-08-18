UPDATE "ContratoConsentimentoTemplate"
SET "grupoDescricao" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "origem" = 'SISTEMA'
  AND "slug" = 'uso-imagem';
