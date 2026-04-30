/**
 * Cancelamento de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices/{id}/cancel
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function cancelInvoice(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/invoices/${params.id}/cancel`);
}
