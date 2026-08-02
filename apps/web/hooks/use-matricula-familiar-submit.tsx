import { useRef, useState } from 'react';
import type {
  FamilyEnrollmentOutcome,
  WizardFamiliarSubmitResult,
  WizardState,
} from '@/components/matriculas/wizard/types';
import { previewInitialEnrollmentBillingRequest } from '@/features/cadastro/matriculas/services/matriculas-service';

interface UseMatriculaFamiliarSubmitOptions {
  onSuccess?: (_outcome: FamilyEnrollmentOutcome) => void;
  onError?: (_error: Error) => void;
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

function applyBenefit(value: number, state: WizardState) {
  const benefit = state.beneficioSelecionado;
  if (!benefit) return value;
  return benefit.tipo === 'PERCENTUAL'
    ? Math.max(0, value - (value * benefit.valor) / 100)
    : Math.max(0, value - benefit.valor);
}

function familyMonthlyAmount(state: WizardState) {
  const total =
    state.modoTurmas === 'TURMAS'
      ? applyBenefit(state.planoValor ?? 0, state)
      : state.alunosFamiliares.reduce(
          (sum, aluno) => sum + applyBenefit(aluno.comboValor ?? 0, state),
          0,
        );
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

function buildPayload(
  state: WizardState,
  uiRequestId: string,
  preview: { previewHash: string; sourceVersion: string; expiresAt: string },
): Record<string, unknown> {
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
      (state.beneficioSelecionado as { origem?: string; id?: string } | undefined)?.origem ===
      'CATALOGO'
        ? [(state.beneficioSelecionado as { id?: string } | undefined)?.id].filter(Boolean)
        : [],
    taxaMatricula: state.taxaMatricula ?? 0,
    taxaIsenta: state.taxaIsenta ?? false,
    taxaJustificativa: state.taxaJustificativa,
    pagarTaxaAgora: state.pagarTaxaAgora ?? false,
    gerarCobrancaTaxa: state.gerarCobrancaTaxa ?? false,
    criarCobranca: state.criarCobranca ?? true,
    dataInicio: state.dataInicio,
    dataFimContrato: state.dataFimContrato,
    vencimentoDia: state.vencimentoDia,
    formaPagamento: normalizePayment(state.formaPagamento),
    formaPagamentoTaxa: normalizePayment(state.formaPagamentoTaxa),
    modeloId: state.modeloId,
    billingStrategy: state.billingStrategy ?? { kind: 'SEPARATE' },
    previewHash: preview.previewHash,
    sourceVersion: preview.sourceVersion,
    previewExpiresAt: preview.expiresAt,
    notificationChannels: Array.isArray(state.notificationChannels) ? state.notificationChannels : [],
    notificationChannelsConfigured: state.notificationChannelsTouched === true,
    multaPercentual: state.multaPercentual,
    jurosMensal: state.jurosMensal,
    descontoAntecipado: state.descontoAntecipado,
    descontoTipo: state.descontoTipo,
    prazoDesconto: state.prazoDesconto,
    uiRequestId,
  };
}

export function useMatriculaFamiliarSubmit(options: UseMatriculaFamiliarSubmitOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WizardFamiliarSubmitResult[]>([]);
  const [outcome, setOutcome] = useState<FamilyEnrollmentOutcome | null>(null);
  // Mantém o uiRequestId estável entre tentativas para garantir idempotência
  // ponta-a-ponta (mesmo se o usuário clicar duas vezes ou der refresh).
  const requestIdRef = useRef<string | null>(null);

  const submit = async (state: WizardState) => {
    setLoading(true);
    setResults([]);

    if (!requestIdRef.current) {
      requestIdRef.current = generateRequestId();
    }
    const uiRequestId = requestIdRef.current;

    try {
      if (state.alunosFamiliares.length === 0) {
        throw new Error('Nenhum aluno selecionado para matrícula familiar.');
      }

      const billingStrategy = state.billingStrategy ?? { kind: 'SEPARATE' as const };
      const descontoIds =
        state.beneficioSelecionado?.origem === 'CATALOGO' ? [state.beneficioSelecionado.id] : [];
      const previewPaymentMethod =
        state.formaPagamento === 'PIX' ||
        state.formaPagamento === 'BOLETO' ||
        state.formaPagamento === 'CARTAO_CREDITO'
          ? state.formaPagamento
          : state.formaPagamento === 'CARTAO'
            ? 'CARTAO_CREDITO'
            : 'BOLETO';
      const preview = await previewInitialEnrollmentBillingRequest({
        contaId: state.contaId || undefined,
        enrollmentMode: 'FAMILY',
        familyPricingMode:
          state.modoTurmas === 'TURMAS' ? 'AGGREGATE_PLAN' : 'ITEMIZED_COMBOS',
        aggregateMonthlyAmount: familyMonthlyAmount(state),
        aggregateEnrollmentFeeAmount: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
        billingStrategy,
        strategy:
          billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
            ? 'INCLUDE_EXISTING'
            : 'CREATE_SEPARATE',
        existingFamilyGroupId:
          billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
            ? billingStrategy.financialGroupId
            : null,
        responsavelFinanceiroId: state.responsavelFamiliar?.id ?? null,
        dataInicio: state.dataInicio ?? '',
        dataFimContrato: state.dataFimContrato ?? '',
        formaPagamento: previewPaymentMethod,
        vencimentoDia: state.vencimentoDia ?? 5,
        descontoIds,
        items: state.alunosFamiliares.map((aluno) => ({
          alunoId: aluno.id,
          turmaId: state.modoTurmas === 'TURMAS' ? aluno.turmaId ?? null : null,
          comboId: state.modoTurmas === 'COMBO' ? aluno.comboId ?? null : null,
          planoId: state.modoTurmas === 'TURMAS' ? state.planoId ?? null : null,
          taxaMatricula: state.taxaMatricula ?? 0,
        })),
      });
      if (!preview.compatibility.compatible) {
        throw new Error(
          preview.compatibility.blockers.map((blocker) => blocker.message).join(' ') ||
            'O agrupamento financeiro escolhido não é compatível.',
        );
      }

      const response = await fetch('/api/matriculas/familiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(state, uiRequestId, preview)),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.error?.message || `Erro HTTP ${response.status}`;
        const fallbackAluno = state.alunosFamiliares[0];
        const errorResults = Array.isArray(payload.results) && payload.results.length > 0
          ? (payload.results as WizardFamiliarSubmitResult[])
          : fallbackAluno
            ? [{
                alunoId: fallbackAluno.id,
                alunoNome: fallbackAluno.nome,
                status: 'error' as const,
                errorMessage: sanitizeMessage(message),
              }]
            : [];

        setResults(errorResults);
        if (
          typeof payload.familyId === 'string' &&
          errorResults.some((result) => result.status === 'success')
        ) {
          const partialOutcome: FamilyEnrollmentOutcome = {
            familyId: payload.familyId,
            operationId:
              typeof payload.operationId === 'string' ? payload.operationId : undefined,
            operationStatus: payload.operationStatus ?? 'FAILED',
            academicStatus: payload.academicStatus ?? 'PARCIAL',
            billingProvisionStatus: payload.billingProvisionStatus ?? 'FALHO',
            paymentStatus: payload.paymentStatus ?? 'PENDENTE',
            financialError: sanitizeMessage(message),
            results: errorResults,
          };
          setOutcome(partialOutcome);
          options.onSuccess?.(partialOutcome);
          requestIdRef.current = null;
          return partialOutcome;
        }
        throw new Error(sanitizeMessage(message));
      }

      const allResults = Array.isArray(payload.results)
        ? (payload.results as WizardFamiliarSubmitResult[])
        : [];
      const accepted: FamilyEnrollmentOutcome = {
        familyId: String(payload.familyId ?? ''),
        operationId: typeof payload.operationId === 'string' ? payload.operationId : undefined,
        operationStatus: payload.operationStatus ?? 'PENDING',
        academicStatus: payload.academicStatus ?? 'PENDENTE',
        billingProvisionStatus: payload.billingProvisionStatus ?? 'PENDENTE',
        paymentStatus: payload.paymentStatus ?? 'PENDENTE',
        financialError: payload.financialError ?? null,
        results: allResults,
      };

      // Sucesso: zera para que um novo wizard gere novo uiRequestId.
      requestIdRef.current = null;

      setResults(allResults);
      setOutcome(accepted);
      options.onSuccess?.(accepted);
      return accepted;
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Erro ao processar matrículas.');
      options.onError?.(error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    requestIdRef.current = null;
    setResults([]);
    setOutcome(null);
  };

  return { submit, loading, results, outcome, reset };
}
