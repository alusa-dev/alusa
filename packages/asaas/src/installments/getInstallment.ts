/**
 * Buscar detalhes de um carnê/parcelamento (installment) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInstallment } from '../types/asaas';

export interface GetInstallmentParams {
  apiKey: string;
  installmentId: string;
}

export async function getInstallment(params: GetInstallmentParams): Promise<AsaasInstallment> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasInstallment>(`/installments/${params.installmentId}`);
}
