import { AsaasHttp } from '../client/AsaasHttp';

export interface DeleteInstallmentPaymentsParams {
  apiKey: string;
  installmentId: string;
}

export interface DeleteInstallmentPaymentsResponse {
  deleted: boolean;
  id: string;
  deletedPayments?: Array<{
    id: string;
    installmentNumber: number | string;
    deleted: boolean;
  }>;
}

export async function deleteInstallmentPayments(
  params: DeleteInstallmentPaymentsParams,
): Promise<DeleteInstallmentPaymentsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<DeleteInstallmentPaymentsResponse>(
    `/installments/${params.installmentId}/payments`,
  );
}