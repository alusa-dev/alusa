export const LEGAL_DOCUMENT_VERSION = '2026-05-27';
export const COOKIE_POLICY_VERSION = '2026-05-27';

export const LEGAL_DOCUMENTS = [
  {
    type: 'TERMS_OF_USE',
    version: LEGAL_DOCUMENT_VERSION,
    title: 'Termos de Uso',
    href: '/termos',
  },
  {
    type: 'PRIVACY_POLICY',
    version: LEGAL_DOCUMENT_VERSION,
    title: 'Politica de Privacidade',
    href: '/privacidade',
  },
  {
    type: 'DPA',
    version: LEGAL_DOCUMENT_VERSION,
    title: 'DPA / Contrato de Tratamento de Dados',
    href: '/dpa',
  },
  {
    type: 'ASAAS_FINANCIAL_SERVICES',
    version: LEGAL_DOCUMENT_VERSION,
    title: 'Servicos Financeiros Asaas',
    href: '/seguranca#financeiro-asaas',
  },
] as const;

export type LegalDocumentType = (typeof LEGAL_DOCUMENTS)[number]['type'];

export function requiredRegisterLegalDocuments() {
  return LEGAL_DOCUMENTS.filter((document) =>
    document.type === 'TERMS_OF_USE' ||
    document.type === 'PRIVACY_POLICY' ||
    document.type === 'DPA',
  );
}
