export type RetentionPolicyEntry = {
  entity: string;
  retention: string;
  rationale: string;
};

export const RETENTION_POLICY = [
  {
    entity: 'WebhookAsaas.payloadRaw',
    retention: 'Evitar armazenamento. Quando inevitavel, criptografar e manter pelo menor prazo operacional.',
    rationale: 'Payloads podem conter CPF/CNPJ, dados bancarios, Pix e identificadores financeiros.',
  },
  {
    entity: 'WebhookAsaas.payloadSanitized',
    retention: 'Manter enquanto necessario para auditoria, idempotencia e reconciliacao financeira.',
    rationale: 'Webhooks sao fonte primaria de mudanca de estado financeiro na Alusa.',
  },
  {
    entity: 'AuditLog',
    retention: 'Longo prazo, conforme obrigacoes contratuais, legais e de auditoria.',
    rationale: 'Preserva rastreabilidade de acoes administrativas, academicas e financeiras.',
  },
  {
    entity: 'AuthLog',
    retention: '12 a 24 meses, conforme risco e politica operacional.',
    rationale: 'Suporta investigacao de abuso, fraude, brute force e acesso indevido.',
  },
  {
    entity: 'Aluno',
    retention: 'Enquanto houver vinculo academico e pelo prazo necessario as obrigacoes da escola.',
    rationale: 'Dados academicos podem estar vinculados a historico escolar, contratos e cobrancas.',
  },
  {
    entity: 'Cobranca',
    retention: 'Conforme obrigacoes legais, contabeis, financeiras, contratuais e de auditoria.',
    rationale: 'Dados financeiros nao devem ser removidos sem avaliar dever legal ou contratual.',
  },
  {
    entity: 'MarketingConsent',
    retention: 'Ate revogacao, inatividade definida ou termino da finalidade.',
    rationale: 'Tratamento nao essencial deve respeitar preferencia do titular.',
  },
] as const satisfies readonly RetentionPolicyEntry[];

export function getRetentionPolicy(entity: string): RetentionPolicyEntry | null {
  return RETENTION_POLICY.find((entry) => entry.entity === entity) ?? null;
}
