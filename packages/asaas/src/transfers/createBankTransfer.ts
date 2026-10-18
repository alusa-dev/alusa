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

  // Transfer recovery must use the local operation ledger and provider
  // reconciliation; this endpoint does not document Idempotency-Key support.
  return client.post<AsaasTransfer>('/transfers', params.data);
}
