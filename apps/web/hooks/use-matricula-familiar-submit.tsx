import { useState } from 'react';
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

function buildPayload(state: WizardState): Record<string, unknown> {
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
    notificationChannelsConfigured: state.notificationChannelsConfigured === true,
    multaPercentual: state.multaPercentual,
    jurosMensal: state.jurosMensal,
    descontoAntecipado: state.descontoAntecipado,
    descontoTipo: state.descontoTipo,
    prazoDesconto: state.prazoDesconto,
    uiRequestId:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}`,
  };
}

export function useMatriculaFamiliarSubmit(options: UseMatriculaFamiliarSubmitOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WizardFamiliarSubmitResult[]>([]);

  const submit = async (state: WizardState) => {
    setLoading(true);
    setResults([]);

    try {
      if (state.alunosFamiliares.length === 0) {
        throw new Error('Nenhum aluno selecionado para matrícula familiar.');
      }

      const response = await fetch('/api/matriculas/familiar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(state)),
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

  return { submit, loading, results };
}
