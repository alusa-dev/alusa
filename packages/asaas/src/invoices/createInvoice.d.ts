/**
 * Agendamento/emissão de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices
 */
import type { AsaasInvoice, CreateInvoiceInput } from '../types/asaas';
export interface CreateInvoiceParams {
    apiKey: string;
    data: CreateInvoiceInput;
    idempotencyKey?: string;
}
export declare function createInvoice(params: CreateInvoiceParams): Promise<AsaasInvoice>;
//# sourceMappingURL=createInvoice.d.ts.map