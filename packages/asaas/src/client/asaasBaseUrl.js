export class AsaasBaseUrlError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'AsaasBaseUrlError';
    }
}
function toTrimmed(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
export function parseAsaasEnvironmentFromEnv() {
    const raw = toTrimmed(process.env.ASAAS_ENVIRONMENT);
    if (!raw)
        return 'unknown';
    const normalized = raw.toLowerCase();
    if (normalized === 'production' || normalized === 'prod')
        return 'production';
    if (normalized === 'sandbox' || normalized === 'development' || normalized === 'dev')
        return 'sandbox';
    return 'unknown';
}
export function normalizeAndValidateAsaasBaseUrl(input, env = 'unknown') {
    const raw = toTrimmed(input);
    if (!raw) {
        throw new AsaasBaseUrlError('ASAAS_BASE_URL não configurada', 'ASAAS_BASE_URL_MISSING');
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
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
        throw new AsaasBaseUrlError('ASAAS_BASE_URL aponta para sandbox, mas ASAAS_ENVIRONMENT=production', 'ASAAS_BASE_URL_ENV_MISMATCH');
    }
    if (env === 'sandbox' && isOfficialProd) {
        throw new AsaasBaseUrlError('ASAAS_BASE_URL aponta para produção, mas ASAAS_ENVIRONMENT=sandbox', 'ASAAS_BASE_URL_ENV_MISMATCH');
    }
    return url.toString();
}
export function getAsaasBaseUrlFromEnvOrThrow() {
    const env = parseAsaasEnvironmentFromEnv();
    const raw = process.env.ASAAS_BASE_URL;
    return normalizeAndValidateAsaasBaseUrl(raw ?? '', env);
}
