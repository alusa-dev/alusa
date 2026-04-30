import { useState } from 'react';
import type { WizardAlunoFamiliar, WizardFamiliarSubmitResult, WizardState } from '@/components/matriculas/wizard/types';
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

function buildPayload(state: WizardState, aluno: WizardAlunoFamiliar): Record<string, unknown> {
  const normalizePayment = (value: unknown) => {
    if (typeof value !== 'string') return value;
    return value === 'CARTAO' ? 'CARTAO_CREDITO' : value;
  };

  return {
    alunoId: aluno.id,
    responsavelFinanceiroId: state.responsavelFamiliar?.id,

    turmaId: state.modoTurmas === 'TURMAS' ? aluno.turmaId : undefined,
    comboId: state.modoTurmas === 'COMBO' ? aluno.comboId : undefined,
    planoId: state.modoTurmas === 'COMBO' ? undefined : state.planoId,

    taxaMatricula: state.taxaIsenta ? 0 : (state.taxaMatricula ?? 0),
    taxaIsenta: state.taxaIsenta ?? false,
    taxaJustificativa: state.taxaJustificativa,
    formaPagamentoTaxa: normalizePayment(state.formaPagamentoTaxa),
    pagarTaxaAgora: state.pagarTaxaAgora ?? false,
    gerarCobrancaTaxa: state.gerarCobrancaTaxa ?? false,

    dataInicio: state.dataInicio,
    dataFimContrato: state.dataFimContrato,
    vencimentoDia: state.vencimentoDia,
    formaPagamento: normalizePayment(state.formaPagamento),
    modeloId: state.modeloId,
    notificationChannels: Array.isArray(state.notificationChannels)
      ? state.notificationChannels
      : [],
    notificationChannelsConfigured: state.notificationChannelsConfigured === true,

    multaPercentual: state.multaPercentual,
    jurosMensal: state.jurosMensal,
    descontoAntecipado: state.descontoAntecipado,
    descontoTipo: state.descontoTipo,
    prazoDesconto: state.prazoDesconto,
    descontoIds:
      (state.beneficioSelecionado as { origem?: string; id?: string } | undefined)?.origem ===
      'CATALOGO'
        ? [(state.beneficioSelecionado as { id?: string } | undefined)?.id].filter(Boolean)
        : [],

    criarCobranca: state.criarCobranca ?? true,
    contaId: state.contaId,
  };
}

async function submitAluno(
  state: WizardState,
  aluno: WizardAlunoFamiliar,
): Promise<WizardFamiliarSubmitResult> {
  try {
    const payload = buildPayload(state, aluno);

    const response = await fetch('/api/matriculas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        errorData.error?.message || `Erro HTTP ${response.status}`;
      throw new Error(sanitizeMessage(message));
    }

    const result = await response.json();

    // Gera contrato se modelo selecionado
    if (state.modeloId) {
      try {
        await createContrato({
          matriculaId: result.matricula.id,
          modeloId: state.modeloId,
        });
      } catch {
        // não bloqueia a matrícula se o contrato falhar
      }
    }

    return {
      alunoId: aluno.id,
      alunoNome: aluno.nome,
      status: 'success',
      matriculaId: result.matricula?.id,
    };
  } catch (e) {
    return {
      alunoId: aluno.id,
      alunoNome: aluno.nome,
      status: 'error',
      errorMessage: sanitizeMessage((e as Error).message),
    };
  }
}

export function useMatriculaFamiliarSubmit(options: UseMatriculaFamiliarSubmitOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WizardFamiliarSubmitResult[]>([]);

  const submit = async (state: WizardState) => {
    setLoading(true);
    setResults([]);

    try {
      const alunos = state.alunosFamiliares;
      if (alunos.length === 0) {
        throw new Error('Nenhum aluno selecionado para matrícula familiar.');
      }

      // Sequential: tolerate partial failure, collect all results
      const allResults: WizardFamiliarSubmitResult[] = [];
      for (const aluno of alunos) {
        const result = await submitAluno(state, aluno);
        allResults.push(result);
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
