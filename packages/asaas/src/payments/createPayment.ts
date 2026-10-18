/**
 * Criação de cobrança (payment) no Asaas
 * 
 * ADR-006: externalReference para rastreabilidade
 * ADR-009: idempotência controlada pelo protocolo local de operações
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreatePaymentInput, AsaasPayment } from '../types/asaas';

export interface CreatePaymentParams {
  apiKey: string;
  data: CreatePaymentInput;
  idempotencyKey?: string;
}

/**
 * Cria uma cobrança (payment) no Asaas
 * 
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da cobrança (deve incluir externalReference)
 * @param params.idempotencyKey - Identificador local da operação; não é uma garantia remota do Asaas
 * @returns Payment criado
 */
export async function createPayment(params: CreatePaymentParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  // Keep the local key in the outbound operation ledger. The Asaas endpoint
  // does not document Idempotency-Key support, so recovery uses externalReference.
  return client.post<AsaasPayment>('/payments', params.data);
}
