/**
 * Obtenção de QR Code PIX de um payment
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Obtém QR Code PIX de um payment
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns QR Code (encodedImage + payload)
 */
export async function getPixQrCode(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    return client.get(`/payments/${params.paymentId}/pixQrCode`);
}
