const REDACTED = '[REDACTED]';

const sensitiveKeyParts = [
  'authorization',
  'cookie',
  'cpf',
  'cnpj',
  'email',
  'password',
  'phone',
  'pix',
  'secret',
  'senha',
  'telefone',
  'token',
];

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const cpfCnpjPattern = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const phonePattern = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/g;
const bearerPattern = /(bearer\s+)[a-z0-9._~+/=-]+/gi;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sensitiveKeyParts.some((part) => normalized.includes(part));
}

function redactString(value: string): string {
  return value
    .replace(bearerPattern, `$1${REDACTED}`)
    .replace(emailPattern, REDACTED)
    .replace(cpfCnpjPattern, REDACTED)
    .replace(phonePattern, (match) => (match.replace(/\D/g, '').length >= 10 ? REDACTED : match));
}

export function redactSensitiveData<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as T;
  if (typeof value === 'string') return redactString(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1)) as T;
  }

  const next: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    next[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveData(entryValue, depth + 1);
  }
  return next as T;
}
