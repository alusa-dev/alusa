const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /auth/i,
  /authorization/i,
  /password/i,
  /senha/i,
  /secret/i,
  /payload/i,
  /rawBody/i,
  /body/i,
  /cpf/i,
  /cnpj/i,
  /cpfCnpj/i,
  /email/i,
  /phone/i,
  /telefone/i,
  /mobile/i,
  /nome/i,
  /name/i,
];

const CPF_CNPJ_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}\b/g;
const LONG_TOKEN_RE = /\b(?:whsec_|token_)?[A-Za-z0-9_-]{24,}\b/g;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactWebhookString(value: string): string {
  return value
    .replace(EMAIL_RE, REDACTED)
    .replace(CPF_CNPJ_RE, REDACTED)
    .replace(PHONE_RE, REDACTED)
    .replace(LONG_TOKEN_RE, REDACTED);
}

export function redactWebhookLogValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (typeof value === 'string') return redactWebhookString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactWebhookString(value.message),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactWebhookLogValue(item, depth + 1));
  if (!isPlainObject(value)) return REDACTED;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactWebhookLogValue(nested, depth + 1);
  }
  return result;
}

export function redactWebhookLogObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return redactWebhookLogValue(value) as Record<string, unknown>;
}
