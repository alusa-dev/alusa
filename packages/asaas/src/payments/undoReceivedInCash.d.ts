/**
 * Desfaz confirmação de recebimento em dinheiro no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasPayment } from '../types/asaas';
export interface UndoReceivedInCashParams {
    apiKey: string;
    paymentId: string;
}
/**
 * Desfaz o recebimento em dinheiro de uma cobrança.
 * O status do pagamento volta para o estado anterior (PENDING ou OVERDUE).
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns Payment atualizado
 */
export declare function undoReceivedInCash(params: UndoReceivedInCashParams): Promise<AsaasPayment>;
//# sourceMappingURL=undoReceivedInCash.d.ts.map