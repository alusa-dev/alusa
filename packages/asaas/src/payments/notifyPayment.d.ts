/**
 * Envio de notificações nativas do Asaas (email/sms/whatsapp)
 *
 * HTTP-only: sem regras de negócio.
 */
export type AsaasNotificationType = 'EMAIL' | 'SMS' | 'WHATSAPP';
export interface NotifyPaymentParams {
    apiKey: string;
    paymentId: string;
    tipo: AsaasNotificationType;
}
export interface NotifyPaymentResponse {
    success: boolean;
    message?: string;
}
export declare function notifyPayment(params: NotifyPaymentParams): Promise<NotifyPaymentResponse>;
//# sourceMappingURL=notifyPayment.d.ts.map