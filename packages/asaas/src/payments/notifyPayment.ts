/**
 * Envio de notificações nativas do Asaas (email/sms/whatsapp)
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';

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

export async function notifyPayment(params: NotifyPaymentParams): Promise<NotifyPaymentResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // Endpoint e payload conforme API do Asaas.
  return client.post<NotifyPaymentResponse>(`/payments/${params.paymentId}/notifications`, {
    notificationType: params.tipo,
  });
}
