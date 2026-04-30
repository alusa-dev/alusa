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

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasInstallment>('/installments', params.data, { headers });
}
