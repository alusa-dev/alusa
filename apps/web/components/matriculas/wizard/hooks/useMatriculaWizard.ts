import { useCallback, useMemo, useState } from 'react';
import type { ModoMatricula, StepId, WizardState, WizardContextValue } from '../types';

const INDIVIDUAL_STEPS: StepId[] = [
  'modo',
  'aluno',
  'turmasCombo',
  'taxa',
  'plano',
  'bolsaBeneficios',
  'jurosMulta',
  'notificacoes',
  'financeiro',
  'resumo',
];

const FAMILIAR_STEPS: StepId[] = [
  'modo',
  'responsavelFamiliar',
  'alunosFamiliares',
  'taxa',
  'plano',
  'bolsaBeneficios',
  'jurosMulta',
  'notificacoes',
  'financeiro',
  'resumo',
];

function getSteps(modoTurmas: 'TURMAS' | 'COMBO', modoMatricula: ModoMatricula): StepId[] {
  const base = modoMatricula === 'FAMILIAR' ? FAMILIAR_STEPS : INDIVIDUAL_STEPS;
  if (modoTurmas === 'COMBO') {
    return base.filter((step) => step !== 'plano');
  }
  return base;
}

const initialState: WizardState = {
  contaId: '',
  modoMatricula: 'INDIVIDUAL',
  modoTurmas: 'TURMAS',
  turmaIds: [],
  alunosFamiliares: [],
  criarCobranca: true,
  confirmacaoRevisao: false,
  taxaIsenta: false,
  pagarTaxaAgora: false,
  gerarCobrancaTaxa: false,
  modeloId: undefined,
  modeloNome: undefined,
  notificationChannels: [],
  notificationChannelsInitialized: false,
  notificationChannelsConfigured: false,
  modoBeneficio: 'SEM',
  beneficioSelecionado: null,
};

export function useMatriculaWizard(contaId?: string): WizardContextValue {
  const [state, setState] = useState<WizardState>({ ...initialState, contaId: contaId ?? '' });
  const [stepIndex, setStepIndex] = useState(0);

  // Steps dinâmicos baseados no modo selecionado
  const steps = useMemo(
    () => getSteps(state.modoTurmas ?? 'TURMAS', state.modoMatricula ?? 'INDIVIDUAL'),
    [state.modoTurmas, state.modoMatricula],
  );

  const update = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const goNext = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const reset = useCallback(
    (patch?: Partial<WizardState>) => {
      setState({ ...initialState, contaId: contaId ?? '', ...patch });
      setStepIndex(0);
    },
    [contaId],
  );

  // Garantir que stepIndex não exceda o tamanho do array de steps
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);

  return useMemo(
    () => ({
      state,
      step: steps[safeStepIndex],
      steps,
      canGoBack: safeStepIndex > 0,
      goNext,
      goBack,
      update,
      reset,
    }),
    [state, safeStepIndex, steps, goNext, goBack, update, reset],
  );
}
