import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { reenviarCobrancaMatricula } from '../services/matriculas-actions-service';

export function useReenviarCobranca() {
  const [loading, setLoading] = useState(false);

  const sanitizeMessage = (message: string) =>
    message
      .replace(/Asaas/gi, 'financeiro')
      .replace(/webhooks?/gi, 'atualizações automáticas')
      .replace(/assinatura/gi, 'cobrança recorrente')
      .trim();

  const reenviar = async (matriculaId: string) => {
    setLoading(true);
    try {
      const result = await reenviarCobrancaMatricula(matriculaId);

      const url = result.invoiceUrl;

      if (!url) {
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Link indisponível"
              description="Não conseguimos preparar o link de pagamento agora. Tente novamente em instantes ou abra os detalhes da matrícula."
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 6000 },
        );
        return result;
      }

      // Copia o link para a área de transferência
      try {
        await navigator.clipboard.writeText(url);

        toast.custom(
          (t) => (
            <CustomToast
              variant="success"
              title="Link de pagamento copiado"
              description="O link da cobrança foi copiado para a área de transferência."
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 5000 },
        );
      } catch (clipboardError) {
        console.warn('[useReenviarCobranca] Erro ao copiar:', clipboardError);
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Link pronto para uso"
              description="Não foi possível copiar automaticamente. Abra os detalhes da matrícula para copiar manualmente."
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 5000 },
        );
      }

      return result;
    } catch (error) {
      console.error('[useReenviarCobranca] Erro:', error);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao gerar link"
          description={sanitizeMessage((error as Error).message || 'Não foi possível preparar o link de pagamento.')}
          onClose={() => toast.dismiss(t)}
        />
      ), { duration: 6000 });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    reenviar,
    loading,
  };
}
