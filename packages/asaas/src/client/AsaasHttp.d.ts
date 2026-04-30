/**
 * Cliente HTTP base para API do Asaas
 *
 * Responsabilidades:
 * - Executar requisições HTTP
 * - Adicionar headers de autenticação
 * - Tratar erros HTTP
 *
 * Não contém:
 * - Lógica de negócio
 * - Persistência
 * - Mapeamento de status
 */
export interface AsaasHttpConfig {
    apiKey: string;
}
export interface AsaasHttpOptions {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
}
export declare class AsaasHttpError extends Error {
    status: number;
    response?: unknown | undefined;
    responseBody?: unknown | undefined;
    constructor(message: string, status: number, response?: unknown | undefined, responseBody?: unknown | undefined);
}
export declare class AsaasHttp {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(config: AsaasHttpConfig);
    get<T>(path: string, options?: AsaasHttpOptions): Promise<T>;
    post<T>(path: string, body?: unknown, options?: AsaasHttpOptions): Promise<T>;
    put<T>(path: string, body?: unknown, options?: AsaasHttpOptions): Promise<T>;
    delete<T>(path: string, options?: AsaasHttpOptions): Promise<T>;
    private request;
    private extractErrorMessage;
}
//# sourceMappingURL=AsaasHttp.d.ts.map