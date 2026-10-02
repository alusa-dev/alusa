export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(?:password|passwd|senha|secret|token|authorization|cookie|api[-_]?key|access[-_]?key|private[-_]?key|account.?key|account.?id|document|cpf|email|phone|telefone|address|endereco|payment|card|pix|webhook[-_]?payload|conta.?id|tenant.?id|user.?id|student.?id|responsible.?id|aluno.?id|responsavel.?id|student.?name|responsible.?name|full.?name)/i;
const STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:asaas_[A-Za-z0-9_-]{12,}|sk_live_[A-Za-z0-9]{12,})\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11}|\d{14})\b/g,
  /(?<!\w)(?:\+\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]\d{4,5}[\s.-]\d{4}(?!\w)/g,
  /\b(?:password|passwd|[\w-]*senha[\w-]*|secret|token|api[-_]?key|access[-_]?key|private[-_]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function redactString(value: string): string {
  return STRING_PATTERNS.reduce((result, pattern) => result.replace(pattern, REDACTED), value);
}

export function redactSensitiveData(value: unknown, maxDepth = 12): unknown {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') return redactString(current);
    if (current === null || typeof current !== 'object') return current;
    if (depth >= maxDepth) return '[TRUNCATED]';
    if (seen.has(current)) return '[CIRCULAR]';
    seen.add(current);
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) output[key] = SENSITIVE_KEY.test(key) ? REDACTED : visit(child, depth + 1);
    return output;
  };
  return visit(value, 0);
}

export function allowlistedAttributes<T extends Record<string, unknown>>(attributes: T, allowedKeys: readonly (keyof T)[]): Partial<T> {
  const allowed = new Set<PropertyKey>(allowedKeys);
  const result: Partial<T> = {};
  for (const key of Object.keys(attributes) as (keyof T)[]) {
    if (allowed.has(key) && !SENSITIVE_KEY.test(String(key))) result[key] = redactSensitiveData(attributes[key]) as T[typeof key];
  }
  return result;
}
