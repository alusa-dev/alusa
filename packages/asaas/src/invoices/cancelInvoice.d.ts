/**
 * Cancelamento de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices/{id}/cancel
 */
import type { AsaasInvoice } from '../types/asaas';
export interface CancelInvoiceParams {
    apiKey: string;
    id: string;
}
export declare function cancelInvoice(params: CancelInvoiceParams): Promise<AsaasInvoice>;
//# sourceMappingURL=cancelInvoice.d.ts.map