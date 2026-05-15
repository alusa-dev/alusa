export function formatDateTime(value?: Date | string | null) {
  if (!value) return 'Sem registro';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDate(value?: Date | string | null) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
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
