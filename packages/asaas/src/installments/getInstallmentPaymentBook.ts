import { AsaasHttp } from '../client/AsaasHttp';

export interface GetInstallmentPaymentBookParams {
  apiKey: string;
  installmentId: string;
}

export interface PaymentBookResponse {
  identificationField?: string;
  nossoNumero?: string;
  barCode?: string;
  pdfUrl?: string;
}

export async function getInstallmentPaymentBook(
  params: GetInstallmentPaymentBookParams,
): Promise<PaymentBookResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<PaymentBookResponse>(`/installments/${params.installmentId}/paymentBook`);
}