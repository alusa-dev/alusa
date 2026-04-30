/**
 * Consulta de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: GET /v3/invoices/{id}
 */
import type { AsaasInvoice } from '../types/asaas';
export interface GetInvoiceParams {
    apiKey: string;
    id: string;
}
export declare function getInvoice(params: GetInvoiceParams): Promise<AsaasInvoice>;
//# sourceMappingURL=getInvoice.d.ts.map