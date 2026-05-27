export type DataSensitivity =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'PERSONAL'
  | 'SENSITIVE'
  | 'FINANCIAL'
  | 'SECRET'
  | 'AUDIT';

export type DataClassificationEntry = {
  field: string;
  sensitivity: DataSensitivity;
  description: string;
};

export const DATA_CLASSIFICATION = [
  { field: 'cpf', sensitivity: 'SENSITIVE', description: 'Documento de identificacao civil.' },
  { field: 'cnpj', sensitivity: 'SENSITIVE', description: 'Documento cadastral da escola ou fornecedor.' },
  { field: 'dataNasc', sensitivity: 'SENSITIVE', description: 'Data de nascimento de aluno, responsavel ou colaborador.' },
  { field: 'alergias', sensitivity: 'SENSITIVE', description: 'Informacao de saude do aluno.' },
  { field: 'restricoesMedicas', sensitivity: 'SENSITIVE', description: 'Informacao de saude do aluno.' },
  { field: 'consentimentoImagem', sensitivity: 'SENSITIVE', description: 'Registro de consentimento educacional.' },
  { field: 'email', sensitivity: 'PERSONAL', description: 'Dado pessoal de contato.' },
  { field: 'telefone', sensitivity: 'PERSONAL', description: 'Dado pessoal de contato.' },
  { field: 'endereco', sensitivity: 'PERSONAL', description: 'Endereco residencial ou institucional.' },
  { field: 'asaasCustomerId', sensitivity: 'FINANCIAL', description: 'Identificador financeiro no Asaas.' },
  { field: 'asaasPaymentId', sensitivity: 'FINANCIAL', description: 'Identificador de cobranca/pagamento no Asaas.' },
  { field: 'asaasApiKey', sensitivity: 'SECRET', description: 'Credencial de integracao financeira.' },
  { field: 'webhookToken', sensitivity: 'SECRET', description: 'Segredo de autenticacao de webhook.' },
  { field: 'auditLog', sensitivity: 'AUDIT', description: 'Trilha de auditoria operacional.' },
] as const satisfies readonly DataClassificationEntry[];

export function classifyField(field: string): DataSensitivity {
  const normalized = field.trim().toLowerCase();
  const match = DATA_CLASSIFICATION.find((entry) => entry.field.toLowerCase() === normalized);
  return match?.sensitivity ?? 'INTERNAL';
}
