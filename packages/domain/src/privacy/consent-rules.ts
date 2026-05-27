export type ConsentPurpose =
  | 'IMAGE_USE'
  | 'MARKETING'
  | 'COMMUNICATIONS'
  | 'FINANCIAL_RESPONSIBLE'
  | 'BILLING_SHARING'
  | 'FINANCIAL_COMMUNICATIONS';

export type ConsentRule = {
  purpose: ConsentPurpose;
  requiresConsent: boolean;
  preferredLegalBasis: string;
  note: string;
};

export const CONSENT_RULES = [
  {
    purpose: 'IMAGE_USE',
    requiresConsent: true,
    preferredLegalBasis: 'consentimento',
    note: 'Uso de imagem de aluno deve registrar aceite especifico quando aplicavel.',
  },
  {
    purpose: 'MARKETING',
    requiresConsent: true,
    preferredLegalBasis: 'consentimento',
    note: 'Comunicacoes promocionais devem iniciar desativadas e respeitar revogacao.',
  },
  {
    purpose: 'COMMUNICATIONS',
    requiresConsent: false,
    preferredLegalBasis: 'execucao de contrato ou legitimo interesse educacional',
    note: 'Comunicacoes operacionais da escola nao devem ser tratadas automaticamente como marketing.',
  },
  {
    purpose: 'FINANCIAL_RESPONSIBLE',
    requiresConsent: false,
    preferredLegalBasis: 'execucao de contrato',
    note: 'Responsavel financeiro e necessario para contrato, cobranca e portal.',
  },
  {
    purpose: 'BILLING_SHARING',
    requiresConsent: false,
    preferredLegalBasis: 'execucao de contrato',
    note: 'Compartilhamento com Asaas ocorre para viabilizar cobrancas e reconciliacao.',
  },
  {
    purpose: 'FINANCIAL_COMMUNICATIONS',
    requiresConsent: false,
    preferredLegalBasis: 'execucao de contrato ou obrigacao legal',
    note: 'Avisos de vencimento, inadimplencia e pagamento sao operacionais.',
  },
] as const satisfies readonly ConsentRule[];

export function getConsentRule(purpose: ConsentPurpose): ConsentRule {
  return CONSENT_RULES.find((rule) => rule.purpose === purpose) ?? CONSENT_RULES[0];
}
