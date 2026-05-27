type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike };

const REDACTED = '[REDACTED]';
const SENSITIVE_EXACT_KEYS = new Set([
  'authorization',
  'authToken',
  'cpf',
  'cpfCnpj',
  'document',
  'documentNumber',
  'email',
  'holderName',
  'name',
  'ownerName',
  'phone',
  'pixAddressKey',
  'token',
]);

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'bankaccount',
  'creditcard',
  'cpf',
  'cnpj',
  'email',
  'name',
  'password',
  'phone',
  'pixaddresskey',
  'secret',
  'telefone',
  'token',
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CPF_CNPJ_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const PHONE_PATTERN = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}/g;
const TOKEN_PATTERN = /(bearer\s+)[a-z0-9._~+/=-]+/gi;

function shouldRedactKey(key: string): boolean {
  if (SENSITIVE_EXACT_KEYS.has(key)) return true;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function sanitizeString(value: string): string {
  return value
    .replace(TOKEN_PATTERN, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(CPF_CNPJ_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, (match) => (match.replace(/\D/g, '').length >= 10 ? REDACTED : match));
}

function sanitizeValue(value: unknown, key?: string): JsonLike {
  if (key && shouldRedactKey(key)) return REDACTED;

  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (typeof value === 'object') {
    const sanitized: Record<string, JsonLike> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[entryKey] = sanitizeValue(entryValue, entryKey);
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeWebhookPayload(payload: unknown): JsonLike {
  return sanitizeValue(payload);
}

export function sanitizeRejectedWebhookPayload(rawBody: string): JsonLike {
  try {
    return sanitizeWebhookPayload(JSON.parse(rawBody));
  } catch {
    return {
      _raw: sanitizeString(rawBody.slice(0, 2048)),
      _parseError: true,
    };
  }
}
