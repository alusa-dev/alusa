/**
 * Confirma recebimento em dinheiro (receiveInCash) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
export interface ReceiveInCashParams {
    apiKey: string;
    paymentId: string;
    paymentDate: string;
    value: number;
    notifyCustomer?: boolean;
}
export interface ReceiveInCashResponse {
    success: boolean;
}
export declare function receiveInCash(params: ReceiveInCashParams): Promise<ReceiveInCashResponse>;
//# sourceMappingURL=receiveInCash.d.ts.map