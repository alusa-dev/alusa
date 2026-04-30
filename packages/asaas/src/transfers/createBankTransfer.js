/**
 * Criação de transferência bancária (TED) no Asaas
 *
 * ADR-003: Repasse automático + saque controlado
 */
import { AsaasHttp } from '../client/AsaasHttp';
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
export async function createBankTransfer(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/transfers', params.data, { headers });
}
