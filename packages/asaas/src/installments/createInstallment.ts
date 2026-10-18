/**
 * Criação de parcelamento/carnê (installments) no Asaas
 *
 * Endpoint oficial: POST /v3/installments
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInstallment, CreateInstallmentInput } from '../types/asaas';

export interface CreateInstallmentParams {
  apiKey: string;
  data: CreateInstallmentInput;
  idempotencyKey?: string;
}

export async function createInstallment(params: CreateInstallmentParams): Promise<AsaasInstallment> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // The local operation key is reconciled through paymentExternalReference;
  // this endpoint does not document provider-side Idempotency-Key support.
  return client.post<AsaasInstallment>('/installments', params.data);
}
