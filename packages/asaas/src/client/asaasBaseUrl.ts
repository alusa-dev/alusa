export type AsaasEnvironment = 'production' | 'sandbox' | 'unknown';

const OFFICIAL_ASAAS_BASE_URLS: Record<Exclude<AsaasEnvironment, 'unknown'>, string> = {
  production: 'https://api.asaas.com/v3/',
  sandbox: 'https://api-sandbox.asaas.com/v3/',
};

export class AsaasBaseUrlError extends Error {
  constructor(
    message: string,
    public code:
      | 'ASAAS_BASE_URL_MISSING'
      | 'ASAAS_BASE_URL_INVALID'
      | 'ASAAS_BASE_URL_PROTOCOL_INVALID'
      | 'ASAAS_BASE_URL_PATH_INVALID'
      | 'ASAAS_BASE_URL_ENV_MISMATCH',
  ) {
    super(message);
    this.name = 'AsaasBaseUrlError';
  }
}

function toTrimmed(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseAsaasEnvironmentFromEnv(): AsaasEnvironment {
  const raw = toTrimmed(process.env.ASAAS_ENVIRONMENT);
  if (!raw) return 'unknown';

  const normalized = raw.toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'production';
  if (normalized === 'sandbox' || normalized === 'development' || normalized === 'dev') return 'sandbox';
  return 'unknown';
}

export function parseAsaasEnvironmentFromApiKey(apiKey: string | undefined | null): AsaasEnvironment {
  const raw = toTrimmed(apiKey);
  if (!raw) return 'unknown';

  const normalized = raw.toLowerCase();
  if (normalized.startsWith('$aact_prod_')) return 'production';
  if (normalized.startsWith('$aact_hmlg_')) return 'sandbox';
  return 'unknown';
}

export function normalizeAndValidateAsaasBaseUrl(input: string, env: AsaasEnvironment = 'unknown'): string {
  const raw = toTrimmed(input);
  if (!raw) {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL não configurada', 'ASAAS_BASE_URL_MISSING');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL inválida (URL inválida)', 'ASAAS_BASE_URL_INVALID');
  }

  if (url.protocol !== 'https:') {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL deve usar https', 'ASAAS_BASE_URL_PROTOCOL_INVALID');
  }

  if (url.username || url.password) {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL inválida (não deve conter credenciais)', 'ASAAS_BASE_URL_INVALID');
  }

  if (url.search || url.hash) {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL inválida (não deve conter query/hash)', 'ASAAS_BASE_URL_INVALID');
  }

  // Path deve ser exatamente /v3 ou /v3/
  const pathname = url.pathname;
  const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (normalizedPath !== '/v3') {
    throw new AsaasBaseUrlError('ASAAS_BASE_URL deve terminar com /v3/', 'ASAAS_BASE_URL_PATH_INVALID');
  }

  // Normaliza para sempre terminar com /v3/
  url.pathname = '/v3/';

  // Validação por ambiente (só quando hostname é o oficial)
  const hostname = url.hostname.toLowerCase();
  const isOfficialProd = hostname === 'api.asaas.com';
  const isOfficialSandbox = hostname === 'api-sandbox.asaas.com';

  if (env === 'production' && isOfficialSandbox) {
    throw new AsaasBaseUrlError(
      'ASAAS_BASE_URL aponta para sandbox, mas ASAAS_ENVIRONMENT=production',
      'ASAAS_BASE_URL_ENV_MISMATCH',
    );
  }

  if (env === 'sandbox' && isOfficialProd) {
    throw new AsaasBaseUrlError(
      'ASAAS_BASE_URL aponta para produção, mas ASAAS_ENVIRONMENT=sandbox',
      'ASAAS_BASE_URL_ENV_MISMATCH',
    );
  }

  return url.toString();
}

export function getAsaasBaseUrlFromEnvOrThrow(): string {
  const env = parseAsaasEnvironmentFromEnv();
  const raw = process.env.ASAAS_BASE_URL;
  return normalizeAndValidateAsaasBaseUrl(raw ?? '', env);
}

export function getAsaasBaseUrlForApiKeyOrThrow(apiKey: string): string {
  const apiKeyEnv = parseAsaasEnvironmentFromApiKey(apiKey);
  if (apiKeyEnv !== 'unknown') {
    return OFFICIAL_ASAAS_BASE_URLS[apiKeyEnv];
  }

  return getAsaasBaseUrlFromEnvOrThrow();
}
