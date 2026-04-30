/**
 * Criação de parcelamento/carnê (installments) no Asaas
 *
 * Endpoint oficial: POST /v3/installments
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Cria um parcelamento no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customer - ID do customer
 * @param params.installmentCount - Número de parcelas
 * @param params.value - Valor de cada parcela
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Installment criado
 */
export async function createInstallments(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    const body = {
        customer: params.customer,
        billingType: params.billingType,
        value: params.value,
        dueDate: params.dueDate,
        installmentCount: params.installmentCount,
        description: params.description,
    };
    return client.post('/installments', body, { headers });
}
