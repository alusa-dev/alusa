export const ACCOUNT_DEACTIVATION_REASON_CODES = [
  'NOT_USING',
  'TOO_EXPENSIVE',
  'DIFFICULT_TO_USE',
  'MISSING_FEATURES',
  'TECHNICAL_ISSUES',
  'SUPPORT_ISSUES',
  'CHANGED_SYSTEM',
  'OTHER',
] as const;

export const ACCOUNT_DEACTIVATION_REASON_OPTIONS = [
  { value: 'NOT_USING', label: 'Não estou usando a plataforma' },
  { value: 'TOO_EXPENSIVE', label: 'O custo não atende às minhas necessidades' },
  { value: 'DIFFICULT_TO_USE', label: 'Tive dificuldades para utilizar' },
  { value: 'MISSING_FEATURES', label: 'Não encontrei os recursos que precisava' },
  { value: 'TECHNICAL_ISSUES', label: 'Problemas técnicos' },
  { value: 'SUPPORT_ISSUES', label: 'Problemas no atendimento' },
  { value: 'CHANGED_SYSTEM', label: 'Minha instituição mudou de sistema' },
  { value: 'OTHER', label: 'Outro' },
] as const;
