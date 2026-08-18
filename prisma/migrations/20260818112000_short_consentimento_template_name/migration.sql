UPDATE "ContratoConsentimentoTemplate"
SET "nome" = 'Consentimento de imagem e voz',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "origem" = 'SISTEMA'
  AND "slug" = 'uso-imagem';
