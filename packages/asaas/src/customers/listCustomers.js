/**
 * Listagem/busca de customers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listCustomers(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/customers', {
        params: {
            search: params.search,
            cpfCnpj: params.cpfCnpj,
            externalReference: params.externalReference,
            offset: params.offset,
            limit: params.limit,
        },
    });
}
