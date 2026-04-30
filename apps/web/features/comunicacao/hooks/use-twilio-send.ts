import { useState, useCallback } from 'react';
import { sendWhatsAppMessage } from '../services/twilio-service';

interface Resultado {
  tipo: 'success' | 'error';
  mensagem: string;
  sid?: string;
  detalhes?: string;
}

/**
 * Hook para envio de mensagens via Twilio WhatsApp
 *
 * @example
 * ```tsx
 * const { send, loading, resultado } = useTwilioSend();
 *
 * const handleEnviar = async () => {
 *   await send('whatsapp:+5511999999999');
 * };
 * ```
 */
export function useTwilioSend() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const send = useCallback(async (numero: string, mensagem?: string) => {
    setLoading(true);
    setResultado(null);

    try {
      const response = await sendWhatsAppMessage({ numero, mensagem });

      setResultado({
        tipo: 'success',
        mensagem: 'Mensagem enviada com sucesso! Verifique o WhatsApp.',
        sid: response.sid,
      });
    } catch (error) {
      console.error('[useTwilioSend] Erro:', error);

      const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar mensagem';
      const detalhes =
        error instanceof Error && 'details' in error
          ? JSON.stringify((error as { details?: unknown }).details, null, 2)
          : undefined;

      setResultado({
        tipo: 'error',
        mensagem: errorMessage,
        detalhes,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const clearResultado = useCallback(() => {
    setResultado(null);
  }, []);

  return {
    send,
    loading,
    resultado,
    clearResultado,
  };
}
