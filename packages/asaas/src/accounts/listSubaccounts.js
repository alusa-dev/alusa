/**
 * Lista subcontas Asaas
 *
 * GET /v3/accounts
 *
 * Útil para:
 * - Verificar se subconta já existe após timeout
 * - Recovery de sucesso fantasma
 * - Reconciliação
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Lista subcontas da conta master.
 *
 * @param params.apiKey - API key da conta master
 * @param params.cpfCnpj - Filtrar por CPF/CNPJ (exato)
 * @param params.email - Filtrar por e-mail (exato)
 * @param params.externalReference - Filtrar por referência externa
 */
export async function listSubaccounts(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const queryParams = {};
    if (params.cpfCnpj)
        queryParams.cpfCnpj = params.cpfCnpj;
    if (params.email)
        queryParams.email = params.email;
    if (params.externalReference)
        queryParams.externalReference = params.externalReference;
    if (params.limit !== undefined)
        queryParams.limit = params.limit;
    if (params.offset !== undefined)
        queryParams.offset = params.offset;
    return client.get('/accounts', { params: queryParams });
}
/**
 * Busca subconta por CPF/CNPJ.
 * Retorna a primeira encontrada ou null.
 */
export async function findSubaccountByCpfCnpj(apiKey, cpfCnpj) {
    const sanitized = cpfCnpj.replace(/\D/g, '');
    const response = await listSubaccounts({ apiKey, cpfCnpj: sanitized, limit: 1 });
    return response.data[0] ?? null;
}
/**
 * Busca subconta por referência externa.
 * Retorna a primeira encontrada ou null.
 */
export async function findSubaccountByExternalReference(apiKey, externalReference) {
    const response = await listSubaccounts({ apiKey, externalReference, limit: 1 });
    return response.data[0] ?? null;
}
