import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import type { WizardState } from '@/components/matriculas/wizard/types';
import { prepararPayloadMatricula } from '@/lib/validations/resumo.schema';
import { createContrato } from '@/features/contratos/services/contratos-service';
import { showNotificationSyncWarnings } from '@/lib/notifications/show-notification-sync-warnings';

export interface MatriculaResponse {
  matricula: {
    id: string;
    alunoId: string;
    status: string;
    statusFinanceiro: string;
    dataInicio: string;
    taxaMatricula: number;
    taxaIsenta: boolean;
    taxaJustificativa?: string | null;
    vencimentoDia: number;
  };
  cobrancas: {
    taxa: {
      id: string;
      valor: number;
      vencimento: string;
      status: string;
      asaasPaymentId?: string | null;
    } | null;
    mensalidade: {
      id: string;
      valor: number;
      vencimento: string;
      status: string;
      asaasPaymentId?: string | null;
    } | null;
  };
  preco: {
    plano: number;
    taxa: number;
    desconto: number;
    total: number;
  };
  responsavelFinanceiro: {
    id: string;
    nome: string;
  };
  primeiroVencimento: string;
  asaasSync?: {
    taxa?: {
      success: boolean;
      error?: string;
      asaasPaymentId?: string;
      invoiceUrl?: string | null;
      bankSlipUrl?: string | null;
    } | null;
    subscription?: {
      success: boolean;
      error?: string;
      asaasSubscriptionId?: string | null;
      message?: string | null;
      expectedWebhooks?: string[];
    } | null;
  };
  notificationSync?: {
    applied: { email: boolean; sms: boolean; whatsapp: boolean };
    warnings: Array<{
      notificationId: string;
      event: string;
      channel: string;
      code: string;
      message: string;
    }>;
  } | null;
}

interface UseMatriculaSubmitOptions {
  onSuccess?: (_data: MatriculaResponse) => void;
  onError?: (_error: Error) => void;
  redirectOnSuccess?: boolean;
}

export function useMatriculaSubmit(options: UseMatriculaSubmitOptions = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<MatriculaResponse | null>(null);

  const sanitizeMessage = (message: string) =>
    message
      .replace(/Asaas/gi, 'financeiro')
      .replace(/webhooks?/gi, 'atualizações automáticas')
      .replace(/assinatura financeira/gi, 'cobrança recorrente')
      .replace(/assinatura/gi, 'cobrança recorrente')
      .replace(/provedor/gi, 'serviço financeiro')
      .trim();

  const submit = async (wizardState: WizardState) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      // Validar e preparar payload usando schema do resumo
      const validationResult = prepararPayloadMatricula(
        wizardState as unknown as Record<string, unknown>,
      );

      if (!validationResult.valido) {
        throw new Error(`Validação falhou: ${validationResult.erros.join(', ')}`);
      }

      const payload = validationResult.payload;

      // Enviar para API
      const response = await fetch('/api/matriculas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const messageParts = [errorData.error?.message || `Erro HTTP ${response.status}`];
        if (Array.isArray(errorData.error?.details)) {
          messageParts.push(errorData.error.details.join(', '));
        } else if (typeof errorData.error?.details === 'string') {
          messageParts.push(errorData.error.details);
        }
        throw new Error(messageParts.filter(Boolean).join(' - '));
      }

      const result: MatriculaResponse = await response.json();
      setData(result);

      if (result.notificationSync?.warnings?.length) {
        showNotificationSyncWarnings(result.notificationSync.warnings, {
          title: 'Matrícula criada — aviso sobre notificações',
        });
      }

      // Gera contrato automaticamente usando o modelo escolhido
      let contratoResult: unknown = null;
      let contratoWarning: string | null = null;
      if (wizardState.modeloId) {
        try {
          contratoResult = await createContrato({
            matriculaId: result.matricula.id,
            modeloId: wizardState.modeloId,
          });
        } catch (contratoError) {
          contratoWarning = `O contrato não foi gerado automaticamente: ${(contratoError as Error).message}`;
        }
      } else {
        contratoWarning = 'O modelo de contrato não foi selecionado para esta matrícula.';
      }

      const contratoComSync = contratoResult as { subscriptionSync?: { success: boolean; error?: string } } | null;
      if (result.asaasSync?.subscription && !result.asaasSync.subscription.success) {
        const syncError = result.asaasSync.subscription.error;
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Matrícula criada"
              description={
                syncError
                  ? `A cobrança recorrente não foi confirmada pelo financeiro ainda. Detalhe: ${sanitizeMessage(syncError)}`
                  : 'A cobrança recorrente foi solicitada, mas ainda aguarda confirmação do financeiro.'
              }
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 7000 },
        );
      }
      if (contratoComSync?.subscriptionSync && !contratoComSync.subscriptionSync.success) {
        const syncError = contratoComSync.subscriptionSync.error;
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Matrícula criada"
              description={
                syncError
                  ? `A cobrança recorrente ainda está em processamento. Detalhe: ${sanitizeMessage(syncError)}`
                  : 'A cobrança recorrente ainda está em processamento. Acompanhe os detalhes da matrícula em instantes.'
              }
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 7000 },
        );
      }
      if (contratoWarning) {
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Matrícula criada"
              description={sanitizeMessage(contratoWarning)}
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 7000 },
        );
      }

      // Toast de sucesso
      toast.custom(
        (t) => (
          <CustomToast
            variant="success"
            title="Matrícula criada com sucesso"
            description={
              contratoWarning
                ? 'Os dados da matrícula foram salvos. O contrato poderá ser gerado depois, sem impactar a cobrança recorrente.'
                : 'Os dados da matrícula foram salvos e o contrato já está disponível para acompanhamento.'
            }
            onClose={() => toast.dismiss(t)}
          />
        ),
        { duration: 5000 },
      );

      // Callback de sucesso
      options.onSuccess?.(result);

      // Redirecionar para o link oficial do Asaas (invoiceUrl) quando houver taxa não isenta
      if (options.redirectOnSuccess !== false) {
        if (
          !result.matricula.taxaIsenta &&
          result.cobrancas?.taxa?.id &&
          wizardState.formaPagamentoTaxa
        ) {
          if (!result.cobrancas.taxa.asaasPaymentId) {
            toast.custom(
              (t) => (
                <CustomToast
                  variant="warning"
                  title="Cobrança não gerada"
                  description="A taxa foi registrada, mas o link de pagamento ainda não ficou disponível. Tente reenviar a cobrança na tela da matrícula."
                  onClose={() => toast.dismiss(t)}
                />
              ),
              { duration: 7000 },
            );

            router.push(`/matriculas/${result.matricula.id}`);
            return result;
          }

          const invoiceUrl = result.asaasSync?.taxa?.invoiceUrl ?? null;
          if (invoiceUrl) {
            window.location.href = invoiceUrl;
            return result;
          }

          toast.custom(
            (t) => (
              <CustomToast
                variant="warning"
                title="Link de pagamento indisponível"
                description="A cobrança foi criada, mas o link de pagamento ainda não ficou disponível. Tente reenviar a cobrança na tela da matrícula."
                onClose={() => toast.dismiss(t)}
              />
            ),
            { duration: 7000 },
          );

          router.push(`/matriculas/${result.matricula.id}`);
        } else {
          router.push(`/matriculas/${result.matricula.id}`);
        }
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Erro desconhecido');
      setError(error);

      // Toast de erro
      toast.custom(
        (t) => (
          <CustomToast
            variant="error"
            title="Erro ao criar matrícula"
            description={sanitizeMessage(error.message) || 'Não foi possível concluir a matrícula. Revise os dados e tente novamente.'}
            onClose={() => toast.dismiss(t)}
          />
        ),
        { duration: 7000 },
      );

      // Callback de erro
      options.onError?.(error);

      throw error;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setLoading(false);
    setError(null);
    setData(null);
  };

  return {
    submit,
    loading,
    error,
    data,
    reset,
  };
}
