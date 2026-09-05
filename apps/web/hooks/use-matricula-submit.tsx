import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import type { WizardState } from '@/components/matriculas/wizard/types';
import { prepararPayloadMatricula } from '@/lib/validations/resumo.schema';
import { showNotificationSyncWarnings } from '@/lib/notifications/show-notification-sync-warnings';
import { previewInitialEnrollmentBillingRequest } from '@/features/cadastro/matriculas/services/matriculas-service';
import type { EnrollmentBillingStrategyDTO } from '@/features/cadastro/matriculas/dtos';
import {
  clearEnrollmentAttempt,
  readEnrollmentAttempt,
  readEnrollmentAttemptStatus,
  saveEnrollmentAttempt,
  sendEnrollmentAttempt,
  EnrollmentSubmissionError,
  type EnrollmentConfirmationState,
} from '@/features/cadastro/matriculas/services/enrollment-attempt';

export type MatriculaResponse = import('@/features/cadastro/matriculas/dtos').CreateMatriculaResultDTO;

interface UseMatriculaSubmitOptions {
  onSuccess?: (_data: MatriculaResponse) => void;
  onError?: (_error: Error) => void;
  redirectOnSuccess?: boolean;
}

type MatriculaApiError = Error & { code?: string };

export function useMatriculaSubmit(options: UseMatriculaSubmitOptions = {}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [confirmationState, setConfirmationState] = useState<EnrollmentConfirmationState>('IDLE');
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
    if (inFlight.current) return null;
    inFlight.current = true;
    setConfirmationState('CONFIRMING');
    setLoading(true);
    setError(null);
    setData(null);
    const processingToast = toast.message('Criando matrícula e configurando as cobranças...');

    const contaId = wizardState.contaId ?? '';
    try {
      const execute = async (): Promise<MatriculaResponse> => {
        const pending = readEnrollmentAttempt(contaId);
        if (pending) {
          const outcome = await readEnrollmentAttemptStatus(pending);
          if (outcome.status === 'COMMITTED') return outcome.result;
          if (outcome.status === 'COMPENSATED') {
            clearEnrollmentAttempt(contaId);
            setConfirmationState('COMPENSATED');
            throw new Error('A tentativa anterior foi desfeita com segurança. Revise os dados e confirme novamente.');
          }
          if (outcome.status === 'NOT_FOUND') return sendEnrollmentAttempt(pending);
          setConfirmationState(outcome.status === 'REQUIRES_RECONCILIATION' ? 'REQUIRES_RECONCILIATION' : 'UNCERTAIN');
          throw new Error(outcome.status === 'REQUIRES_RECONCILIATION'
            ? 'A confirmação precisa de conferência financeira. A tentativa foi preservada; consulte novamente após a reconciliação.'
            : 'A confirmação ainda está em processamento. Consulte novamente em alguns instantes.');
        }
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

      const attempt = { contaId, uiRequestId, body: JSON.stringify(commitPayload) };
      saveEnrollmentAttempt(attempt);
      return sendEnrollmentAttempt(attempt);
      };
      const result = await execute();
      clearEnrollmentAttempt(contaId);
      setConfirmationState('IDLE');
      setData(result);

      toast.dismiss(processingToast);

      if (result.notificationSync?.warnings?.length) {
        showNotificationSyncWarnings(result.notificationSync.warnings, {
          title: 'Matrícula criada — aviso sobre notificações',
        });
      }

      const warning = result.operationalWarnings?.[0];
      const subscriptionSyncPending =
        result.asaasSync?.subscription && !result.asaasSync.subscription.success;

      if (warning || subscriptionSyncPending) {
        const syncError = result.asaasSync?.subscription?.error;
        const description = warning
          ? sanitizeMessage(warning.message)
          : syncError
            ? `A cobrança recorrente ainda não foi confirmada pelo financeiro. Detalhe: ${sanitizeMessage(syncError)}`
            : 'A matrícula foi criada, mas a confirmação financeira ainda está em processamento.';

        toast.custom(
          (t) => (
            <CustomToast
              variant="warning"
              title="Matrícula criada — confirmação pendente"
              description={description}
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 8000 },
        );
      } else {
        toast.custom(
          (t) => (
            <CustomToast
              variant="success"
              title="Matrícula criada com sucesso"
              description="A matrícula e a cobrança recorrente foram configuradas e já estão disponíveis para acompanhamento."
              onClose={() => toast.dismiss(t)}
            />
          ),
          { duration: 5000 },
        );
      }

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
      const error = (err instanceof Error ? err : new Error('Erro desconhecido')) as MatriculaApiError;
      if (error instanceof EnrollmentSubmissionError && error.safelyRejected) {
        clearEnrollmentAttempt(contaId);
        setConfirmationState('IDLE');
      } else {
        setConfirmationState((current) => current === 'CONFIRMING' ? 'UNCERTAIN' : current);
      }
      setError(error);

      const message = error.code === 'CONTRATO_SEM_RECORRENCIA'
        ? 'A data final do contrato precisa incluir pelo menos dois vencimentos. Ajuste a vigência e tente novamente.'
        : error.code === 'DATA_FIM_INVALIDA'
          ? 'A data final do contrato precisa ser igual ou posterior ao primeiro vencimento. Ajuste a vigência e tente novamente.'
          : sanitizeMessage(error.message) || 'Não foi possível concluir a matrícula. Revise os dados e tente novamente.';

      toast.custom(
        (t) => (
          <CustomToast
            variant="error"
            title="Não foi possível criar a matrícula"
            description={message}
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
      toast.dismiss(processingToast);
      inFlight.current = false;
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
    confirmationState,
    loading,
    error,
    data,
    reset,
  };
}
