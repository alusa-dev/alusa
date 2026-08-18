-- Templates versionados de consentimento. Templates SISTEMA são globais;
-- templates de CONTA ficam isolados pelo contaId.

CREATE TYPE "ContratoConsentimentoTemplateOrigem" AS ENUM ('SISTEMA', 'CONTA');

CREATE TABLE "ContratoConsentimentoTemplate" (
  "id" TEXT NOT NULL,
  "contaId" TEXT,
  "slug" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "finalidade" "ContratoConsentimentoFinalidade" NOT NULL,
  "titulo" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "variaveis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "versao" INTEGER NOT NULL DEFAULT 1,
  "origem" "ContratoConsentimentoTemplateOrigem" NOT NULL DEFAULT 'SISTEMA',
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContratoConsentimentoTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContratoConsentimentoTemplate"
  ADD CONSTRAINT "ContratoConsentimentoTemplate_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_contrato_consentimento_template_scope_slug_versao"
  ON "ContratoConsentimentoTemplate"("contaId", "slug", "versao");

CREATE INDEX "idx_contrato_consentimento_template_conta_ativo"
  ON "ContratoConsentimentoTemplate"("contaId", "ativo");

CREATE INDEX "idx_contrato_consentimento_template_origem_ativo"
  ON "ContratoConsentimentoTemplate"("origem", "ativo");

ALTER TABLE "ContratoModeloConsentimento"
  ADD COLUMN "templateId" TEXT,
  ADD COLUMN "templateVersao" INTEGER;

ALTER TABLE "ContratoModeloConsentimento"
  ADD CONSTRAINT "ContratoModeloConsentimento_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ContratoConsentimentoTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_contrato_modelo_consentimento_template"
  ON "ContratoModeloConsentimento"("templateId");

INSERT INTO "ContratoConsentimentoTemplate"
  ("id", "slug", "nome", "finalidade", "titulo", "texto", "variaveis", "versao", "origem", "ativo", "updatedAt")
VALUES
  (
    'consentimento-sistema-uso-imagem-v1',
    'uso-imagem',
    'Autorização de uso de imagem e voz',
    'IMAGE_USE',
    'Termo de autorização e consentimento para uso de imagem e voz',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a captação e o uso da imagem e da voz de {{nome_aluno}}, para fins institucionais, pedagógicos e de divulgação da instituição, conforme as condições apresentadas neste contrato.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-comunicacoes-v1',
    'comunicacoes-promocionais',
    'Comunicações promocionais',
    'MARKETING',
    'Autorização para comunicações promocionais',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo o recebimento de comunicações promocionais da instituição pelos canais informados no cadastro.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante']::TEXT[],
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-comunicacoes-operacionais-v1',
    'comunicacoes-operacionais',
    'Comunicações operacionais',
    'COMMUNICATIONS',
    'Autorização para comunicações operacionais',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo o recebimento de comunicações operacionais relacionadas à matrícula de {{nome_aluno}}.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante']::TEXT[],
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  );
