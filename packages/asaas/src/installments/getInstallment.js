/**
 * Buscar detalhes de um carnê/parcelamento (installment) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getInstallment(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/installments/${params.installmentId}`);
}
