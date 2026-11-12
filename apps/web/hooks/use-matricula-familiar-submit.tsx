import { useRef, useState } from 'react';
import type {
  FamilyEnrollmentOutcome,
  WizardFamiliarSubmitResult,
  WizardState,
} from '@/features/enrollments/components/wizard/types';
import { previewInitialEnrollmentBillingRequest } from '@/features/enrollments/services/enrollments-service';
import { calculateFamilyMonthlyTotal } from '@/features/enrollments/components/wizard/family-pricing';
import { hasRecurringMonthlyCharge } from '@/features/enrollments/components/wizard/recurring-billing';
import {
  clearFamilyEnrollmentAttempt,
  isSafelyRejectedFamilyIntent,
  parseFamilyEnrollmentResponse,
  parseFamilyOperationDetails,
  parseFamilyEnrollmentResults,
  readFamilyEnrollmentAttempt,
  saveFamilyEnrollmentAttempt,
} from '@/features/enrollments/services/family-enrollment-attempt';

interface UseMatriculaFamiliarSubmitOptions {
  onSuccess?: (_outcome: FamilyEnrollmentOutcome) => void;
  onError?: (_error: Error) => void;
  onAttemptResume?: () => void;
}

const sanitizeMessage = (message: string) =>
  message
    .replace(/Asaas/gi, 'financeiro')
    .replace(/webhooks?/gi, 'atualizações automáticas')
    .replace(/assinatura financeira/gi, 'cobrança recorrente')
    .replace(/assinatura/gi, 'cobrança recorrente')
    .replace(/provedor/gi, 'serviço financeiro')
    .trim();

function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildPayload(
  state: WizardState,
  uiRequestId: string,
  preview: { previewHash: string; sourceVersion: string; expiresAt: string },
): Record<string, unknown> {
  const hasRecurringBilling = hasRecurringMonthlyCharge(state);
  const normalizePayment = (value: unknown) => {
    if (typeof value !== 'string') return value;
    return value === 'CARTAO' ? 'CARTAO_CREDITO' : value;
  };

  return {
    contaId: state.contaId,
    responsavelId: state.responsavelFamiliar?.id,
    modoTurmas: state.modoTurmas,
    planoId: state.modoTurmas === 'TURMAS' ? state.planoId : undefined,
    alunos: state.alunosFamiliares.map((aluno) => ({
      itemId: aluno.itemId,
      alunoId: aluno.id,
      turmaId: state.modoTurmas === 'TURMAS' ? aluno.turmaId : undefined,
      comboId: state.modoTurmas === 'COMBO' ? aluno.comboId : undefined,
    })),
    descontoIds:
      [],
    condicaoFinanceira: state.condicaoFinanceira ?? 'NORMAL',
    condicaoPercentual: state.condicaoFinanceira === 'BOLSA_PARCIAL' ? state.condicaoPercentual : undefined,
    condicaoMotivo: state.condicaoFinanceira === 'NORMAL' ? undefined : state.condicaoMotivo,
    condicaoValidaAte: state.condicaoFinanceira === 'NORMAL' ? undefined : state.condicaoValidaAte,
    taxaMatricula: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
    taxaIsenta: state.taxaIsenta ?? false,
    taxaJustificativa: state.taxaJustificativa,
    pagarTaxaAgora: state.pagarTaxaAgora ?? false,
    gerarCobrancaTaxa: state.gerarCobrancaTaxa ?? false,
    criarCobranca: hasRecurringBilling,
    dataInicio: state.dataInicio,
    dataFimContrato: state.dataFimContrato,
    vencimentoDia: hasRecurringBilling ? state.vencimentoDia : undefined,
    formaPagamento: hasRecurringBilling ? normalizePayment(state.formaPagamento) : undefined,
    formaPagamentoTaxa: normalizePayment(state.formaPagamentoTaxa),
    modeloId: state.modeloId,
    billingStrategy: hasRecurringBilling ? state.billingStrategy ?? { kind: 'SEPARATE' } : { kind: 'SEPARATE' },
    previewHash: preview.previewHash,
    sourceVersion: preview.sourceVersion,
    previewExpiresAt: preview.expiresAt,
    notificationChannels: hasRecurringBilling && Array.isArray(state.notificationChannels)
      ? state.notificationChannels
      : [],
    notificationChannelsConfigured: hasRecurringBilling && state.notificationChannelsTouched === true,
    multaPercentual: hasRecurringBilling ? state.multaPercentual : undefined,
    jurosMensal: hasRecurringBilling ? state.jurosMensal : undefined,
    descontoAntecipado: hasRecurringBilling ? state.descontoAntecipado : undefined,
    descontoTipo: hasRecurringBilling ? state.descontoTipo : undefined,
    prazoDesconto: hasRecurringBilling ? state.prazoDesconto : undefined,
    uiRequestId,
  };
}

export function useMatriculaFamiliarSubmit(options: UseMatriculaFamiliarSubmitOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WizardFamiliarSubmitResult[]>([]);
  const [outcome, setOutcome] = useState<FamilyEnrollmentOutcome | null>(null);
  // Mantém o uiRequestId estável entre tentativas para garantir idempotência
  // ponta-a-ponta (mesmo se o usuário clicar duas vezes ou der refresh).
  const inFlightRef = useRef(false);

  const submit = async (state: WizardState) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setResults([]);

    try {
      if (state.alunosFamiliares.length === 0) {
        throw new Error('Nenhum aluno selecionado para matrícula familiar.');
      }

      if (!state.contaId) throw new Error('Conta não identificada para matrícula familiar.');
      const attempt = readFamilyEnrollmentAttempt(state.contaId);
      if (attempt) options.onAttemptResume?.();
      const uiRequestId = attempt?.uiRequestId ?? generateRequestId();
      let body = attempt?.body;

      if (!body) {
        const billingStrategy = state.billingStrategy ?? { kind: 'SEPARATE' as const };
        const hasRecurringBilling = hasRecurringMonthlyCharge(state);
        const effectiveBillingStrategy = hasRecurringBilling ? billingStrategy : { kind: 'SEPARATE' as const };
        const descontoIds: string[] = [];
        const previewPaymentMethod =
          state.formaPagamento === 'PIX' ||
          state.formaPagamento === 'BOLETO' ||
          state.formaPagamento === 'CARTAO_CREDITO'
            ? state.formaPagamento
            : state.formaPagamento === 'CARTAO'
              ? 'CARTAO_CREDITO'
              : 'BOLETO';
        const preview = await previewInitialEnrollmentBillingRequest({
          condicaoFinanceira: state.condicaoFinanceira ?? 'NORMAL',
          condicaoPercentual: state.condicaoFinanceira === 'BOLSA_PARCIAL' ? state.condicaoPercentual : undefined,
          contaId: state.contaId || undefined,
          enrollmentMode: 'FAMILY',
          familyPricingMode: state.modoTurmas === 'TURMAS' ? 'AGGREGATE_PLAN' : 'ITEMIZED_COMBOS',
          aggregateMonthlyAmount: calculateFamilyMonthlyTotal(state),
          aggregateEnrollmentFeeAmount: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
          billingStrategy: effectiveBillingStrategy,
          strategy:
            effectiveBillingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
              ? 'INCLUDE_EXISTING'
              : effectiveBillingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
                ? 'UNIFY_NEXT_CYCLE'
                : 'CREATE_SEPARATE',
          existingFamilyGroupId:
            effectiveBillingStrategy.kind !== 'SEPARATE'
              ? effectiveBillingStrategy.financialGroupId
              : null,
          responsavelFinanceiroId: state.responsavelFamiliar?.id ?? null,
          dataInicio: state.dataInicio ?? '',
          dataFimContrato: state.dataFimContrato ?? '',
          formaPagamento: hasRecurringBilling ? previewPaymentMethod : 'BOLETO',
          vencimentoDia: state.vencimentoDia ?? 5,
          descontoIds,
          items: state.alunosFamiliares.map((aluno) => ({
            alunoId: aluno.id,
            turmaId: state.modoTurmas === 'TURMAS' ? (aluno.turmaId ?? null) : null,
            comboId: state.modoTurmas === 'COMBO' ? (aluno.comboId ?? null) : null,
            planoId: state.modoTurmas === 'TURMAS' ? (state.planoId ?? null) : null,
            taxaMatricula: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
          })),
        });
        if (!preview.compatibility.compatible) {
          throw new Error(
            preview.compatibility.blockers.map((blocker) => blocker.message).join(' ') ||
              'O agrupamento financeiro escolhido não é compatível.',
          );
        }

        body = buildPayload(state, uiRequestId, preview);
        saveFamilyEnrollmentAttempt({ contaId: state.contaId, uiRequestId, body });
      }

      const response = await fetch('/api/matriculas/familiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const rawPayload: unknown = await response.json().catch(() => undefined);
      const parsedPayload = parseFamilyEnrollmentResponse(rawPayload);
      const payload = parsedPayload.success ? parsedPayload.data : {};
      const nestedDetails =
        payload.error?.details && typeof payload.error.details === 'object'
          ? parseFamilyOperationDetails(payload.error.details)
          : null;
      const operationStatus =
        payload.operationStatus ??
        (nestedDetails?.success ? nestedDetails.data.operationStatus : undefined);
      if (
        response.status === 202 &&
        (payload.data?.state === 'PROCESSING' || operationStatus === 'PROCESSING')
      ) {
        setOutcome(null);
        throw new Error(
          payload.data?.state === 'PROCESSING' ||
            (nestedDetails?.success && nestedDetails.data.operationStatus === 'PROCESSING')
            ? 'A matrícula familiar continua em processamento. A tentativa foi preservada; aguarde e retome para consultar novamente.'
            : 'A solicitação foi aceita, mas ainda não há confirmação de matrícula. A tentativa foi preservada.',
        );
      }
      if (!response.ok) {
        const message = payload.error?.message || `Erro HTTP ${response.status}`;
        const fallbackAluno = state.alunosFamiliares[0];
        const parsedResults = parseFamilyEnrollmentResults(payload.results);
        const errorResults =
          parsedResults.success && parsedResults.data.length > 0
            ? parsedResults.data
            : fallbackAluno
              ? [
                  {
                    alunoId: fallbackAluno.id,
                    alunoNome: fallbackAluno.nome,
                    status: 'error' as const,
                    errorMessage: sanitizeMessage(message),
                  },
                ]
              : [];

        const rolledBackMessage =
          payload.error?.code === 'FALHA_CRIACAO_MATRICULAS_FAMILIARES' ||
          operationStatus === 'FAILED'
            ? 'Nenhuma matrícula foi criada: o lote familiar inteiro foi desfeito.'
            : null;
        const normalizedResults = rolledBackMessage
          ? errorResults.map((result) =>
              result.status === 'success'
                ? {
                    ...result,
                    status: 'error' as const,
                    matriculaId: undefined,
                    contratoId: undefined,
                    errorMessage: rolledBackMessage,
                  }
                : result,
            )
          : errorResults;
        setResults(normalizedResults);
        // Uma falha global não pode reutilizar a mesma confirmação. O backend
        // mantém a operação como trilha de auditoria e exige novo preview/id.
        const terminalPreviousOperation =
          payload.error?.code === 'NOVA_TENTATIVA_NECESSARIA' &&
          nestedDetails?.success &&
          ['FAILED', 'CANCELLED'].includes(nestedDetails.data.operationStatus ?? '');
        const terminalBatchRollback =
          payload.error?.code === 'FALHA_CRIACAO_MATRICULAS_FAMILIARES' &&
          payload.operationStatus === 'FAILED' &&
          operationStatus !== 'REQUIRES_RECONCILIATION' &&
          nestedDetails?.success !== true;
        if (
          (isSafelyRejectedFamilyIntent(payload.error?.code) && response.status < 500) ||
          terminalPreviousOperation ||
          terminalBatchRollback
        ) {
          clearFamilyEnrollmentAttempt(state.contaId);
        }
        const reconciliation =
          operationStatus === 'REQUIRES_RECONCILIATION' ||
          payload.error?.code === 'REQUIRES_RECONCILIATION';
        throw new Error(
          sanitizeMessage(
            reconciliation
              ? `${message} O resultado pode estar incompleto; a tentativa original foi preservada para reconciliação.`
              : message,
          ),
        );
      }

      const parsedResults = parseFamilyEnrollmentResults(payload.results);
      const allResults = parsedResults.success
        ? parsedResults.data.filter(
            (item) => item.status === 'success' && Boolean(item.matriculaId),
          )
        : [];
      const academicCompleted = payload.academicStatus === 'COMPLETO';
      const isProcessing =
        operationStatus === 'PROCESSING' ||
        operationStatus === 'REQUIRES_RECONCILIATION' ||
        payload.data?.state === 'PROCESSING';
      const operationIsRecorded = operationStatus === 'PENDING' || operationStatus === 'COMPLETED';
      const validFamilyId = typeof payload.familyId === 'string' && payload.familyId.length > 0;
      const submittedItems = Array.isArray(body.alunos) ? body.alunos : [];
      const expectedIds = submittedItems.flatMap((item) =>
        item && typeof item === 'object' && 'alunoId' in item && typeof item.alunoId === 'string'
          ? [item.alunoId]
          : [],
      );
      const actualIds = allResults.map((item) => item.alunoId).sort();
      if (
        isProcessing ||
        !operationIsRecorded ||
        !parsedPayload.success ||
        !academicCompleted ||
        !validFamilyId ||
        JSON.stringify(actualIds) !== JSON.stringify([...expectedIds].sort())
      ) {
        setOutcome(null);
        throw new Error(
          isProcessing
            ? 'A matrícula familiar continua em processamento. A tentativa foi preservada.'
            : 'A resposta ainda não confirma todas as matrículas. A tentativa original foi preservada.',
        );
      }
      const accepted: FamilyEnrollmentOutcome = {
        familyId: String(payload.familyId ?? ''),
        operationId: typeof payload.operationId === 'string' ? payload.operationId : undefined,
        operationStatus,
        academicStatus: payload.academicStatus ?? 'PENDENTE',
        billingProvisionStatus: payload.billingProvisionStatus ?? 'PENDENTE',
        paymentStatus: payload.paymentStatus ?? 'PENDENTE',
        financialError: payload.financialError ?? null,
        results: allResults,
      };

      // Sucesso: zera para que um novo wizard gere novo uiRequestId.
      clearFamilyEnrollmentAttempt(state.contaId);

      setResults(allResults);
      setOutcome(accepted);
      options.onSuccess?.(accepted);
      return accepted;
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Erro ao processar matrículas.');
      options.onError?.(error);
      throw error;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const reset = () => {
    setResults([]);
    setOutcome(null);
  };

  return { submit, loading, results, outcome, reset };
}
