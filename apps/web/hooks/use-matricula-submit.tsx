import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import type { WizardState } from '@/components/matriculas/wizard/types';
import { prepararPayloadMatricula } from '@/lib/validations/resumo.schema';
import { showNotificationSyncWarnings } from '@/lib/notifications/show-notification-sync-warnings';
import { previewInitialEnrollmentBillingRequest } from '@/features/cadastro/matriculas/services/matriculas-service';
import type { EnrollmentBillingStrategyDTO } from '@/features/cadastro/matriculas/dtos';

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
  operationalWarnings?: Array<{
    type:
      | 'FINANCIAL_PROVISION_PENDING'
      | 'FINANCIAL_PROVISION_FAILED'
      | 'RECONCILIATION_REQUIRED'
      | 'MANUAL_INTERVENTION_REQUIRED';
    code: string;
    message: string;
    severity?: 'INFO' | 'WARNING' | 'BLOCKER';
    resourceId?: string | null;
    actionLabel?: string | null;
  }>;
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

  const generateRequestId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `matricula-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const resolveBillingStrategy = (wizardState: WizardState): EnrollmentBillingStrategyDTO => {
    const maybeStrategy = (wizardState as { billingStrategy?: EnrollmentBillingStrategyDTO })
      .billingStrategy;
    if (maybeStrategy?.kind) return maybeStrategy;
    return { kind: 'SEPARATE' };
  };

  const numberFromPayload = (value: unknown, fallback = 0) => {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) ? number : fallback;
  };

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
      if (!payload) {
        throw new Error('Não foi possível preparar os dados da matrícula.');
      }
      const billingStrategy = resolveBillingStrategy(wizardState);
      const uiRequestId =
        (wizardState as { uiRequestId?: string }).uiRequestId?.trim() || generateRequestId();

      const formaPagamento = String(payload.formaPagamento ?? 'BOLETO');
      const previewFormaPagamento =
        formaPagamento === 'CARTAO'
          ? 'CARTAO_CREDITO'
          : formaPagamento === 'PIX' ||
              formaPagamento === 'BOLETO' ||
              formaPagamento === 'CARTAO_CREDITO'
            ? formaPagamento
            : 'BOLETO';
      const billingPreview = await previewInitialEnrollmentBillingRequest({
        contaId: typeof payload.contaId === 'string' ? payload.contaId : undefined,
        billingStrategy,
        strategy:
          billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
            ? 'INCLUDE_EXISTING'
            : billingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
              ? 'UNIFY_NEXT_CYCLE'
              : 'CREATE_SEPARATE',
        existingFamilyGroupId:
          'financialGroupId' in billingStrategy ? billingStrategy.financialGroupId : null,
        responsavelFinanceiroId:
          typeof payload.responsavelFinanceiroId === 'string'
            ? payload.responsavelFinanceiroId
            : null,
        dataInicio: String(payload.dataInicio ?? ''),
        dataFimContrato: String(payload.dataFimContrato ?? ''),
        formaPagamento: previewFormaPagamento as 'BOLETO' | 'PIX' | 'CARTAO_CREDITO',
        vencimentoDia: numberFromPayload(payload.vencimentoDia, 5),
        descontoIds: Array.isArray(payload.descontoIds)
          ? payload.descontoIds.filter((id): id is string => typeof id === 'string')
          : [],
        items: [
          {
            alunoId: String(payload.alunoId ?? ''),
            turmaId: typeof payload.turmaId === 'string' ? payload.turmaId : null,
            comboId: typeof payload.comboId === 'string' ? payload.comboId : null,
            planoId: typeof payload.planoId === 'string' ? payload.planoId : null,
            taxaMatricula: numberFromPayload(payload.taxaMatricula),
            valorMensalidadeOverride:
              payload.valorMensalidadeOverride === null ||
              payload.valorMensalidadeOverride === undefined
                ? null
                : numberFromPayload(payload.valorMensalidadeOverride),
          },
        ],
      });

      if (!billingPreview.compatibility.compatible) {
        const details = billingPreview.compatibility.blockers
          .map((blocker) => blocker.message)
          .join(', ');
        throw new Error(details || 'O preview financeiro precisa ser revisado antes da confirmação.');
      }

      const commitPayload = {
        ...payload,
        uiRequestId,
        billingStrategy,
        previewHash: billingPreview.previewHash,
        sourceVersion: billingPreview.sourceVersion,
        previewExpiresAt: billingPreview.expiresAt,
      };

      // Enviar para API
      const response = await fetch('/api/matriculas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commitPayload),
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

      if (result.operationalWarnings?.length) {
        const warning = result.operationalWarnings[0];
        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Matrícula criada"
              description={sanitizeMessage(warning.message)}
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 7000 },
        );
      }

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
      // Toast de sucesso
      toast.custom(
        (t) => (
          <CustomToast
            variant="success"
            title="Matrícula criada com sucesso"
            description="Os dados da matrícula e o contrato foram salvos juntos e já estão disponíveis para acompanhamento."
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
      // Falhas esperadas de validação ou confirmação já foram apresentadas no toast.
      // Não relançar evita que o overlay de desenvolvimento trate uma resposta 4xx/503
      // como erro de aplicação e esconda a mensagem útil do usuário.
      return null;
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
