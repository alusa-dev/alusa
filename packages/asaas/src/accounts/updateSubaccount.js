/**
 * Atualização de subconta Asaas (white-label)
 *
 * ADR-001: Uma subconta por tenant
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function updateSubaccount(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    const sanitized = Object.fromEntries(Object.entries(params.data).filter(([, value]) => value !== undefined && value !== null));
    return client.put(`/accounts/${params.accountId}`, sanitized);
}
