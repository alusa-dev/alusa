import type { DataSensitivity } from './data-classification';

export type DataMapEntry = {
  entity: string;
  fields: string[];
  category: 'STUDENT' | 'GUARDIAN' | 'STAFF' | 'TENANT' | 'FINANCE' | 'AUTH' | 'AUDIT' | 'SUPPORT';
  sensitivity: DataSensitivity;
  purpose: string[];
  legalBasis: string[];
  retention: string;
  sharedWith: string[];
  ownerPackage: string;
};

export const ALUSA_DATA_MAP = [
  {
    entity: 'Aluno',
    fields: ['nome', 'cpf', 'dataNasc', 'endereco', 'alergias', 'restricoesMedicas', 'consentimentoImagem'],
    category: 'STUDENT',
    sensitivity: 'SENSITIVE',
    purpose: ['matricula', 'gestao academica', 'frequencia', 'comunicacao escolar', 'portal do aluno/responsavel'],
    legalBasis: ['execucao de contrato', 'obrigacao legal quando aplicavel', 'legitimo interesse educacional quando aplicavel'],
    retention: 'enquanto houver vinculo academico + prazos legais/contratuais da escola',
    sharedWith: ['escola contratante', 'suboperadores necessarios'],
    ownerPackage: 'packages/domain',
  },
  {
    entity: 'Responsavel',
    fields: ['nome', 'cpf', 'email', 'telefone', 'endereco', 'asaasCustomerId', 'creditCardBrand', 'creditCardLast4'],
    category: 'GUARDIAN',
    sensitivity: 'FINANCIAL',
    purpose: ['responsavel financeiro', 'contratos', 'cobrancas', 'portal do responsavel', 'comunicacoes financeiras'],
    legalBasis: ['execucao de contrato', 'obrigacao legal quando aplicavel'],
    retention: 'enquanto houver vinculo, contrato, cobranca ou obrigacao legal/financeira',
    sharedWith: ['escola contratante', 'Asaas quando necessario para cobranca'],
    ownerPackage: 'packages/domain',
  },
  {
    entity: 'WebhookAsaas',
    fields: ['evento', 'eventId', 'payloadHash', 'payload', 'asaasPaymentId', 'asaasSubscriptionId', 'asaasTransferId'],
    category: 'FINANCE',
    sensitivity: 'FINANCIAL',
    purpose: ['mudanca de estado financeiro', 'idempotencia', 'reconciliacao', 'auditoria'],
    legalBasis: ['execucao de contrato', 'obrigacao legal quando aplicavel', 'legitimo interesse em seguranca e auditoria'],
    retention: 'payload sanitizado mantido para auditoria/reconciliacao; payload bruto deve ser evitado',
    sharedWith: ['Asaas', 'equipe de suporte autorizada quando necessario'],
    ownerPackage: 'packages/finance',
  },
  {
    entity: 'LegalAcceptance',
    fields: ['documentType', 'documentVersion', 'acceptedAt', 'ipHash', 'userAgentHash', 'source'],
    category: 'AUDIT',
    sensitivity: 'AUDIT',
    purpose: ['prova de aceite', 'cumprimento contratual', 'auditoria'],
    legalBasis: ['execucao de contrato', 'legitimo interesse', 'exercicio regular de direitos'],
    retention: 'enquanto a conta existir + prazo necessario para defesa de direitos',
    sharedWith: ['Alusa', 'escola contratante quando aplicavel'],
    ownerPackage: 'apps/web',
  },
] as const satisfies readonly DataMapEntry[];

export function listDataMapByEntity(entity: string): DataMapEntry[] {
  return ALUSA_DATA_MAP.filter((entry) => entry.entity === entity);
}
