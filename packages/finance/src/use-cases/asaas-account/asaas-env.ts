import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';

export type WebhookBaseUrlSource = 'ASAAS_WEBHOOK_PUBLIC_BASE_URL' | 'NEXT_PUBLIC_APP_URL';

const PUBLIC_HOST_CANONICAL_ALIASES: Readonly<Record<string, string>> = {
  'alusa.app': 'app.alusa.app',
  'www.alusa.app': 'app.alusa.app',
};

export function canonicalizePublicHostname(hostname: string): string {
  return PUBLIC_HOST_CANONICAL_ALIASES[hostname.toLowerCase()] ?? hostname;
}

export function canonicalizePublicBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    parsed.hostname = canonicalizePublicHostname(parsed.hostname);
    return parsed.origin;
  } catch {
    return trimmed;
  }
}

export function getMasterAsaasApiKey(): string {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) {
    throw new MissingAsaasApiKeyError();
  }
  return apiKey;
}

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    typeof process.env.VITEST_WORKER_ID === 'string' ||
    typeof process.env.VITEST_POOL_ID === 'string'
  );
}

export function assertValidPublicBaseUrl(value: string, source: WebhookBaseUrlSource): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} inválida.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`${source} deve usar https.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    throw new Error(`${source} deve ser uma URL pública.`);
  }
}

export function resolveConfiguredWebhookBaseUrl(): { value: string; source: WebhookBaseUrlSource } | null {
  const explicitWebhookBaseUrl = process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL?.trim();
  if (explicitWebhookBaseUrl) {
    return {
      value: canonicalizePublicBaseUrl(explicitWebhookBaseUrl),
      source: 'ASAAS_WEBHOOK_PUBLIC_BASE_URL',
    };
  }

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) {
    return {
      value: canonicalizePublicBaseUrl(publicAppUrl),
      source: 'NEXT_PUBLIC_APP_URL',
    };
  }

  return null;
}

export function resolveWebhookUrlOrNull(): string | null {
  const configured = resolveConfiguredWebhookBaseUrl();
  if (!configured) {
    return isTestRuntime() ? 'http://localhost:3000/api/webhooks/asaas' : null;
  }

  if (!isTestRuntime()) {
    try {
      assertValidPublicBaseUrl(configured.value, configured.source);
    } catch {
      return null;
    }
  }

  return `${configured.value.replace(/\/$/, '')}/api/webhooks/asaas`;
}

export function resolveWebhookUrl(): string {
  const configured = resolveConfiguredWebhookBaseUrl();
  if (!configured) {
    if (isTestRuntime()) return 'http://localhost:3000/api/webhooks/asaas';
    throw new Error('ASAAS_WEBHOOK_PUBLIC_BASE_URL ou NEXT_PUBLIC_APP_URL não configurada.');
  }

  if (!isTestRuntime()) {
    assertValidPublicBaseUrl(configured.value, configured.source);
  }

  return `${configured.value.replace(/\/$/, '')}/api/webhooks/asaas`;
}
