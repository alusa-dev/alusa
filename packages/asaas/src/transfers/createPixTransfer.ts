/**
 * Criação de transferência PIX no Asaas
 * 
 * ADR-003: Repasse automático + saque controlado
 * ADR-009: Segurança e auditoria
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreatePixTransferInput, AsaasTransfer } from '../types/asaas';

export interface CreatePixTransferParams {
  apiKey: string;
  data: CreatePixTransferInput;
  idempotencyKey?: string;
}

/**
 * Cria uma transferência PIX no Asaas
 * 
 * ⚠️ Esta função executa operação financeira real.
 * Validações de saldo/limite devem ocorrer em packages/finance.
 * 
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da transferência PIX
 * @returns Transfer criada
 */
export async function createPixTransfer(params: CreatePixTransferParams): Promise<AsaasTransfer> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasTransfer>('/transfers', {
    ...params.data,
    operationType: 'PIX',
  }, { headers });
}
