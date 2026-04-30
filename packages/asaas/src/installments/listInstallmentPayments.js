/**
 * Listar payments de um carnê/parcelamento (installment) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listInstallmentPayments(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/installments/${params.installmentId}/payments`, {
        params: {
            status: params.status,
            offset: params.offset,
            limit: params.limit,
        },
    });
}
