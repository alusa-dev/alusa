/**
 * Obtém informações de cobrança (billing info) de um pagamento no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
export interface BillingInfoPix {
    encodedImage: string;
    payload: string;
    expirationDate: string;
    description?: string;
}
export interface BillingInfoBankSlip {
    identificationField: string;
    nossoNumero: string;
    barCode: string;
    bankSlipUrl: string;
    daysAfterDueDateToRegistrationCancellation?: number;
}
export interface BillingInfoCreditCard {
    creditCardNumber: string;
    creditCardBrand: string;
    creditCardToken?: string;
}
export interface BillingInfoResponse {
    pix?: BillingInfoPix;
    bankSlip?: BillingInfoBankSlip;
    creditCard?: BillingInfoCreditCard;
}
export interface GetBillingInfoParams {
    apiKey: string;
    paymentId: string;
}
/**
 * Obtém informações de cobrança (QR Code Pix, boleto, etc.)
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns Informações de cobrança
 */
export declare function getBillingInfo(params: GetBillingInfoParams): Promise<BillingInfoResponse>;
//# sourceMappingURL=getBillingInfo.d.ts.map