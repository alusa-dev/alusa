/**
 * Processar pagamento de uma cobrança existente via cartão de crédito
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasCreditCard, AsaasCreditCardHolderInfo, AsaasPayment } from '../types/asaas';
export interface PayWithCreditCardInput {
    creditCard?: AsaasCreditCard;
    creditCardHolderInfo?: AsaasCreditCardHolderInfo;
    creditCardToken?: string;
    remoteIp?: string;
}
export interface PayWithCreditCardParams {
    apiKey: string;
    paymentId: string;
    data: PayWithCreditCardInput;
}
export declare function payWithCreditCard(params: PayWithCreditCardParams): Promise<AsaasPayment>;
//# sourceMappingURL=payWithCreditCard.d.ts.map