export type AsaasEnvironment = 'production' | 'sandbox' | 'unknown';
export declare class AsaasBaseUrlError extends Error {
    code: 'ASAAS_BASE_URL_MISSING' | 'ASAAS_BASE_URL_INVALID' | 'ASAAS_BASE_URL_PROTOCOL_INVALID' | 'ASAAS_BASE_URL_PATH_INVALID' | 'ASAAS_BASE_URL_ENV_MISMATCH';
    constructor(message: string, code: 'ASAAS_BASE_URL_MISSING' | 'ASAAS_BASE_URL_INVALID' | 'ASAAS_BASE_URL_PROTOCOL_INVALID' | 'ASAAS_BASE_URL_PATH_INVALID' | 'ASAAS_BASE_URL_ENV_MISMATCH');
}
export declare function parseAsaasEnvironmentFromEnv(): AsaasEnvironment;
export declare function normalizeAndValidateAsaasBaseUrl(input: string, env?: AsaasEnvironment): string;
export declare function getAsaasBaseUrlFromEnvOrThrow(): string;
//# sourceMappingURL=asaasBaseUrl.d.ts.map