export function formatDateTime(value?: Date | string | null) {
  if (!value) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDate(value?: Date | string | null) {
  if (!value) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}

const supportStatusLabels: Record<string, string> = {
  ATIVO: 'Ativa',
  INATIVO: 'Inativa',
  FINANCE_NOT_STARTED: 'Não iniciado',
  FINANCE_ONBOARDING_STARTED: 'Configuração iniciada',
  FINANCE_PROFILE_COMPLETED: 'Perfil preenchido',
  FINANCE_IN_ANALYSIS: 'Em análise',
  FINANCE_APPROVED: 'Aprovado',
  FINANCE_REJECTED: 'Rejeitado',
  WHITELABEL_BAAS: 'Marca branca (BaaS)',
  EXTERNAL_ASAAS_ACCOUNT: 'Conta Asaas externa',
  NOT_STARTED: 'Não iniciado',
  PENDING_CONFIGURATION: 'Configuração pendente',
  CONNECTING: 'Conectando',
  WEBHOOK_PENDING: 'Webhook pendente',
  READY: 'Pronto',
  IN_PROGRESS: 'Em andamento',
  READY_FOR_PROVISIONING: 'Pronto para provisionar',
  PROVISIONING: 'Em provisionamento',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  PROVISIONING_FAILED: 'Falha no provisionamento',
  CONNECTED: 'Conectada',
  DISCONNECTED: 'Desconectada',
  ACTIVE: 'Ativo',
  DISABLED: 'Desativado',
  DELETED: 'Excluída',
  DELETING: 'Em exclusão',
  DELETION_FAILED: 'Falha na exclusão',
  PENDING_EXTERNAL_DELETE: 'Aguardando exclusão externa',
  DELETED_EXTERNALLY: 'Excluída externamente',
  NOT_CONFIGURED: 'Não configurado',
  DRIFT: 'Divergente',
  INTERRUPTED: 'Interrompido',
  INVALID_URL: 'URL inválida',
  AUTH_TOKEN_MISMATCH: 'Token divergente',
  NOT_READY: 'Não pronto',
  API_KEY_REQUIRED: 'API key necessária',
  WEBHOOK_REQUIRED: 'Webhook necessário',
  KYC_PENDING: 'KYC pendente',
  OPERATIONAL: 'Operacional',
  BLOCKED: 'Bloqueado',
  AWAITING_APPROVAL: 'Aguardando aprovação',
  WAITING_MIN_TIMEOUT: 'Aguardando janela mínima',
  PENDING_DOCUMENTS: 'Documentos pendentes',
  EXTERNAL_IN_PROGRESS: 'Em andamento externo',
  INTERNAL_UPLOADING: 'Envio interno',
  EXTERNAL_ONBOARDING_URL: 'Link externo de onboarding',
  INTERNAL_UPLOAD: 'Envio interno',
  NOT_SENT: 'Não enviado',
  IGNORED: 'Ignorado',
  EXPIRING_SOON: 'Expira em breve',
  EXPIRED: 'Expirado',
  NOT_REQUESTED: 'Não solicitada',
  CANCELED: 'Cancelada',
  CANCELLED: 'Cancelada',
  PAID: 'Paga',
  CREATED: 'Criada',
  FISICA: 'Pessoa física',
  JURIDICA: 'Pessoa jurídica',
  PF: 'Pessoa física',
  PJ: 'Pessoa jurídica',
  MEI: 'MEI',
  LIMITED: 'Limitada',
  INDIVIDUAL: 'Individual',
  ASSOCIATION: 'Associação',
  IMMEDIATE: 'Imediata',
  REQUIRES_PAYMENT: 'Exige pagamento',
  ADMIN: 'Administrador',
  FINANCEIRO: 'Financeiro',
  RECEPCAO: 'Recepção',
  PROFESSOR: 'Professor',
  RESPONSAVEL: 'Responsável',
  A_VENCER: 'A vencer',
  PENDENTE: 'Pendente',
  PROCESSANDO: 'Processando',
  PAGO: 'Pago',
  ATRASADO: 'Atrasado',
  CANCELAMENTO_PENDENTE: 'Cancelamento pendente',
  CANCELADO: 'Cancelado',
  ESTORNADO: 'Estornado',
  ESTORNADO_PARCIAL: 'Estornado parcialmente',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Recebido',
  RECEIVED_IN_CASH: 'Recebido em dinheiro',
  OVERDUE: 'Atrasado',
  REFUNDED: 'Estornado',
  PROCESSADO: 'Processado',
  PROCESSED: 'Processado',
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  ONE_TIME: 'Avulsa',
  INSTALLMENT: 'Parcelada',
  SUBSCRIPTION: 'Recorrente',
  ERROR: 'Erro',
  FAILED: 'Falhou',
  OPEN: 'Aberto',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
  WAITING: 'Aguardando',
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
  TAXA_MATRICULA: 'Taxa de matrícula',
  MENSALIDADE: 'Mensalidade',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelada',
  RECORRENTE: 'Recorrente',
};

export function formatSupportStatus(value?: string | null) {
  if (!value) return 'Não informado';
  return supportStatusLabels[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
}

export function formatCurrency(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function maskDocument(value?: string | null) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14)
    return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-${digits.slice(12)}`;
  return value ? 'Documento mascarado' : 'Sem documento';
}

export function compactId(value?: string | null) {
  if (!value) return 'Sem ID';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function isTechnicalChargeText(value?: string | null): boolean {
  if (!value) return true;
  const normalized = value.trim().toUpperCase();
  return (
    normalized === 'NEEDS_REVIEW' ||
    normalized.startsWith('NEEDS_REVIEW ·') ||
    normalized.startsWith('[NEEDS_REVIEW]') ||
    normalized === 'PAYMENT SEM VÍNCULO LOCAL'
  );
}

export function supportChargeTitle(input: {
  description?: string | null;
  payerName?: string | null;
}): string {
  const description = input.description?.trim();
  if (description && !isTechnicalChargeText(description)) return description;

  const payerName = input.payerName?.trim();
  if (payerName && !isTechnicalChargeText(payerName)) return payerName;

  return 'Cobrança sem identificação';
}

export function supportChargeTrace(input: {
  description?: string | null;
  status?: string | null;
  asaasPaymentId?: string | null;
  id?: string | null;
}): string {
  const status = input.status?.trim().toUpperCase();
  const needsReview =
    status === 'NEEDS_REVIEW' ||
    status === 'PAYMENT_NEEDS_REVIEW' ||
    isTechnicalChargeText(input.description);
  const statusLabel = needsReview ? 'Revisão necessária' : input.status ?? 'Sem status';
  return `${statusLabel} · ${compactId(input.asaasPaymentId ?? input.id)}`;
}

export function normalizeSearch(query: string) {
  return query.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function maskEmail(value?: string | null) {
  if (!value) return 'Sem e-mail';
  const [name, domain] = value.split('@');
  if (!name || !domain) return 'E-mail mascarado';
  return `${name.slice(0, 2)}***@${domain}`;
}

export function maskPhone(value?: string | null) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length < 4) return value ? 'Telefone mascarado' : 'Sem telefone';
  return `(**) *****-${digits.slice(-4)}`;
}

export function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveJson);
  if (!value || typeof value !== 'object') return value;

  const sensitive = new Set([
    'cpf',
    'cnpj',
    'cpfCnpj',
    'email',
    'phone',
    'mobilePhone',
    'password',
    'apiKey',
    'accessToken',
    'creditCardNumber',
    'creditCardToken',
    'holderName',
    'remoteIp',
  ]);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitive.has(key) || /token|secret|password|card|cpf|cnpj/i.test(key)
        ? '[mascarado]'
        : redactSensitiveJson(item),
    ]),
  );
}
