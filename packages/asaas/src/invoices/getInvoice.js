/**
 * Consulta de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: GET /v3/invoices/{id}
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getInvoice(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/invoices/${params.id}`);
}
