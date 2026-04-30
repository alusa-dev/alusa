/**
 * Extrato (financialTransactions) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listFinancialTransactions(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/financialTransactions', {
        params: {
            offset: params.offset,
            limit: params.limit,
            startDate: params.startDate,
            finishDate: params.finishDate,
            order: params.order,
        },
    });
}
