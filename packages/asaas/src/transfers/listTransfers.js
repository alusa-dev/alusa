/**
 * Listagem de transfers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listTransfers(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/transfers', {
        params: {
            'dateCreated[ge]': params.dateCreatedGe,
            'dateCreated[le]': params.dateCreatedLe,
            'transferDate[ge]': params.transferDateGe,
            'transferDate[le]': params.transferDateLe,
            type: params.type,
            offset: params.offset,
            limit: params.limit,
        },
    });
}
