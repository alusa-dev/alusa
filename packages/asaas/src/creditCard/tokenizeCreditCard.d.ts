/**
 * Tokenização de cartão de crédito no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasCreditCard, AsaasCreditCardHolderInfo } from '../types/asaas';
export interface TokenizeCreditCardInput {
    customer: string;
    creditCard: AsaasCreditCard;
    creditCardHolderInfo: AsaasCreditCardHolderInfo;
    remoteIp?: string;
}
export interface TokenizeCreditCardParams {
    apiKey: string;
    data: TokenizeCreditCardInput;
}
export interface TokenizeCreditCardResponse {
    creditCardToken: string;
}
export declare function tokenizeCreditCard(params: TokenizeCreditCardParams): Promise<TokenizeCreditCardResponse>;
//# sourceMappingURL=tokenizeCreditCard.d.ts.map