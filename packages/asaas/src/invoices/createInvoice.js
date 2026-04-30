/**
 * Agendamento/emissão de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function createInvoice(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/invoices', params.data, { headers });
}
