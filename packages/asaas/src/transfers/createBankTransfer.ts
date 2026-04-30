/**
 * Criação de transferência bancária (TED) no Asaas
 * 
 * ADR-003: Repasse automático + saque controlado
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreateBankTransferInput, AsaasTransfer } from '../types/asaas';

export interface CreateBankTransferParams {
  apiKey: string;
  data: CreateBankTransferInput;
  idempotencyKey?: string;
}

/**
 * Cria uma transferência bancária (TED) no Asaas
 * 
 * ⚠️ Esta função executa operação financeira real.
 * Validações de saldo/limite devem ocorrer em packages/finance.
 * 
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da transferência bancária
 * @returns Transfer criada
 */
export async function createBankTransfer(
  params: CreateBankTransferParams,
): Promise<AsaasTransfer> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasTransfer>('/transfers', params.data, { headers });
}
