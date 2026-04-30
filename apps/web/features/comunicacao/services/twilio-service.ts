/**
 * Service para comunicação com API Twilio
 */

export interface SendWhatsAppMessageInput {
  numero: string;
  mensagem?: string;
}

export interface SendWhatsAppMessageResponse {
  success: boolean;
  sid: string;
  status: string;
  to: string;
}

/**
 * Envia mensagem via Twilio WhatsApp
 *
 * @param input - Dados da mensagem (número será formatado automaticamente)
 * @returns Resposta com SID da mensagem
 * @throws Error se falhar
 *
 * @example
 * ```ts
 * const response = await sendWhatsAppMessage({
 *   numero: '(97) 98110-6749',
 *   mensagem: 'Olá!'
 * });
 *
 * console.log(response.sid); // 'SM123...'
 * ```
 */
export async function sendWhatsAppMessage(
  input: SendWhatsAppMessageInput,
): Promise<SendWhatsAppMessageResponse> {
  const response = await fetch('/api/twilio/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage = data.error || data.message || 'Erro ao enviar mensagem';
    const error = new Error(errorMessage);
    if (data.details) {
      (error as { details?: unknown }).details = data.details;
    }
    throw error;
  }

  return data;
}
