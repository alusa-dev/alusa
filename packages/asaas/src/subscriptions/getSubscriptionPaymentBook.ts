import { AsaasHttp } from '../client/AsaasHttp';

export interface GetSubscriptionPaymentBookParams {
  apiKey: string;
  subscriptionId: string;
}

export interface PaymentBookResponse {
  identificationField?: string;
  nossoNumero?: string;
  barCode?: string;
  pdfUrl?: string;
}

export async function getSubscriptionPaymentBook(
  params: GetSubscriptionPaymentBookParams,
): Promise<PaymentBookResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<PaymentBookResponse>(`/subscriptions/${params.subscriptionId}/paymentBook`);
}