-- Consentimento de comunicações deve ser explícito e auditável.
ALTER TABLE "Aluno"
  ALTER COLUMN "consentimentoComunicacoes" SET DEFAULT false,
  ADD COLUMN "dataConsentimentoComunicacoes" TIMESTAMP(3),
  ADD COLUMN "versaoConsentimentoComunicacoes" TEXT,
  ADD COLUMN "origemConsentimentoComunicacoes" TEXT,
  ADD COLUMN "consentimentoMarketing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dataConsentimentoMarketing" TIMESTAMP(3),
  ADD COLUMN "versaoConsentimentoMarketing" TEXT,
  ADD COLUMN "origemConsentimentoMarketing" TEXT;

ALTER TABLE "Responsavel"
  ADD COLUMN "consentimentoComunicacoes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dataConsentimentoComunicacoes" TIMESTAMP(3),
  ADD COLUMN "versaoConsentimentoComunicacoes" TEXT,
  ADD COLUMN "origemConsentimentoComunicacoes" TEXT,
  ADD COLUMN "consentimentoMarketing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dataConsentimentoMarketing" TIMESTAMP(3),
  ADD COLUMN "versaoConsentimentoMarketing" TEXT,
  ADD COLUMN "origemConsentimentoMarketing" TEXT;

ALTER TABLE "ContractWhatsAppNotification"
  ADD COLUMN "consentimentoRegistrado" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consentimentoVersao" TEXT,
  ADD COLUMN "consentimentoOrigem" TEXT,
  ADD COLUMN "consentimentoRegistradoEm" TIMESTAMP(3),
  ADD COLUMN "consentimentoRevogadoEm" TIMESTAMP(3);

-- Registros legados tinham aceite implícito pelo default anterior. Exigir novo
-- aceite explícito evita tratar silêncio como autorização.
UPDATE "Aluno" SET "consentimentoComunicacoes" = false;
