import { useRef, useState } from 'react';
import type { WizardFamiliarSubmitResult, WizardState } from '@/components/matriculas/wizard/types';
import { createContrato } from '@/features/contratos/services/contratos-service';

interface UseMatriculaFamiliarSubmitOptions {
  onSuccess?: (_results: WizardFamiliarSubmitResult[]) => void;
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

function buildPayload(state: WizardState, uiRequestId: string): Record<string, unknown> {
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

      const response = await fetch('/api/matriculas/familiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(state, uiRequestId)),
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
        options.onSuccess?.(errorResults);
        return errorResults;
      }

      const allResults = Array.isArray(payload.results)
        ? (payload.results as WizardFamiliarSubmitResult[])
        : [];

      if (state.modeloId) {
        for (const result of allResults) {
          if (result.status !== 'success' || !result.matriculaId) continue;
          try {
            await createContrato({
              matriculaId: result.matriculaId,
              modeloId: state.modeloId,
            });
          } catch {
            // não bloqueia o fluxo se um contrato falhar
          }
        }
      }

      // Sucesso: zera para que um novo wizard gere novo uiRequestId.
      requestIdRef.current = null;

      setResults(allResults);
      options.onSuccess?.(allResults);
      return allResults;
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
  };

  return { submit, loading, results, reset };
}
