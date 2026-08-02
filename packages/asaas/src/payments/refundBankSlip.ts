import { AsaasHttp } from '../client/AsaasHttp';

export type RefundBankSlipParams = {
  apiKey: string;
  paymentId: string;
};

export type RefundBankSlipResponse = {
  requestUrl: string;
};

/** Inicia o estorno de boleto; a devolução só continua após o pagador preencher o formulário. */
export async function refundBankSlip(
  params: RefundBankSlipParams,
): Promise<RefundBankSlipResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<RefundBankSlipResponse>(
    `/payments/${params.paymentId}/bankSlip/refund`,
  );
}
