'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { StepAluno } from './wizard/steps/StepAluno';
import { StepModoMatricula } from './wizard/steps/StepModoMatricula';
import { StepResponsavelFamiliar } from './wizard/steps/StepResponsavelFamiliar';
import { StepAlunosFamiliares } from './wizard/steps/StepAlunosFamiliares';
import { StepTurmasCombo } from './wizard/steps/StepTurmasCombo';
import { StepPlano } from './wizard/steps/StepPlano';
import { StepBolsaBeneficios } from './wizard/steps/StepBolsaBeneficios';
import { StepJurosMulta } from './wizard/steps/StepJurosMulta';
import { StepNotificacoes } from './wizard/steps/StepNotificacoes';
import { StepFinanceiro } from './wizard/steps/StepFinanceiro';
import { StepResumo } from './wizard/steps/StepResumo';
import { StepTaxa } from './wizard/steps/StepTaxa';
import { useMatriculaWizard } from './wizard/hooks/useMatriculaWizard';
import type { WizardContextValue, WizardFamiliarSubmitResult, WizardState } from './wizard/types';
import type { MatriculaCreatedPayload } from '@/features/cadastro/matriculas/services/matriculas-service';
import { useMatriculaSubmit } from '@/hooks/use-matricula-submit';
import { useMatriculaFamiliarSubmit } from '@/hooks/use-matricula-familiar-submit';

type WizardVariant = 'dialog' | 'page';

interface MatriculaWizardFlowProps {
  contaId?: string;
  open?: boolean;
  variant?: WizardVariant;
  onClose?: () => void;
  onCompleted?: (_payload: MatriculaCreatedPayload) => void;
}

function canAdvanceFromModo(_state: WizardState) {
  // Auto-advances on click, so always true here
  return true;
}

function canAdvanceFromResponsavelFamiliar(state: WizardState) {
  return Boolean(state.responsavelFamiliar?.id);
}

function canAdvanceFromAlunosFamiliares(state: WizardState) {
  const alunos = state.alunosFamiliares;
  if (alunos.length < 2) return false;
  // All active alunos must have turma or combo selected
  return alunos.every((a) => {
    if (a.ativo === false) return false;
    if (state.modoTurmas === 'COMBO') return Boolean(a.comboId);
    return Boolean(a.turmaId);
  });
}

function canSubmitFamiliar(state: WizardState) {
  if (!state.responsavelFamiliar?.id) return false;
  if (state.alunosFamiliares.length < 2) return false;
  if (!canAdvanceFromAlunosFamiliares(state)) return false;
  if (!state.dataInicio) return false;
  if (!state.dataFimContrato) return false;
  if (!state.formaPagamento) return false;
  if (!state.modeloId) return false;
  if (!canAdvanceFromTaxa(state)) return false;
  if (state.confirmacaoRevisao !== true) return false;
  return true;
}

function canAdvanceFromAluno(state: WizardState) {
  if (!state.aluno) return false;
  const aluno = state.aluno;
  if (aluno.ativo === false) return false;
  if (!aluno.dataNasc) return true;
  const nascimento = new Date(aluno.dataNasc);
  if (Number.isNaN(nascimento.getTime())) return true;
  const hoje = new Date();
  const idade =
    hoje.getFullYear() -
    nascimento.getFullYear() -
    (hoje < new Date(hoje.getFullYear(), nascimento.getMonth(), nascimento.getDate()) ? 1 : 0);
  if (idade < 18 && !aluno.responsavel) return false;
  return true;
}

function canAdvanceFromTaxa(state: WizardState) {
  if (state.taxaIsenta) return true;
  return Number(state.taxaMatricula ?? 0) > 0;
}

function canAdvanceFromTurmas(state: WizardState) {
  if (state.modoTurmas === 'COMBO') {
    return Boolean(state.comboId);
  }
  return Boolean(state.turmaIds?.[0]);
}

function canAdvanceFromPlano(state: WizardState) {
  return Boolean(state.planoId);
}

function canAdvanceFromBolsaBeneficios(state: WizardState) {
  if ((state.modoBeneficio ?? 'SEM') === 'SEM') return true;
  return Boolean(state.beneficioSelecionado?.id);
}

function canAdvanceFromFinanceiro(state: WizardState) {
  return Boolean(state.formaPagamento && state.dataInicio && state.dataFimContrato && state.modeloId);
}

function canSubmit(state: WizardState) {
  if (!state.aluno?.id) return false;
  // planoId só é obrigatório quando não é combo
  if (state.modoTurmas !== 'COMBO' && !state.planoId) return false;
  if (!state.dataInicio) return false;
  if (!state.dataFimContrato) return false;
  if (!state.formaPagamento) return false;
  if (!state.modeloId) return false;
  if (!canAdvanceFromTaxa(state)) return false;
  if (!canAdvanceFromTurmas(state)) return false;
  if (state.confirmacaoRevisao !== true) return false;
  return true;
}

export function MatriculaWizardFlow({
  contaId,
  open,
  variant = 'dialog',
  onClose,
  onCompleted,
}: MatriculaWizardFlowProps) {
  const wizard = useMatriculaWizard(contaId);
  const prevOpenRef = useRef<boolean | undefined>(open);
  const prevContaRef = useRef<string | undefined>(contaId);
  const [familiarResults, setFamiliarResults] = useState<WizardFamiliarSubmitResult[] | null>(null);

  // Hook de submissão de matrícula
  const { submit, loading: submitting } = useMatriculaSubmit({
    redirectOnSuccess: false, // Não redirecionar, usar callback
    onSuccess: (result) => {
      console.log('[MatriculaWizardFlow] Matrícula criada com sucesso:', result.matricula.id);

      // Primeiro resetar o wizard e fechar o dialog
      wizard.reset({ contaId: contaId ?? '' });
      onClose?.();

      // Depois chamar callback para recarregar listagem
      onCompleted?.(result as unknown as MatriculaCreatedPayload);

      console.log('[MatriculaWizardFlow] Callbacks executados');
    },
    onError: (error) => {
      console.error('[MatriculaWizardFlow] Erro ao criar matrícula:', error);
    },
  });

  const { submit: submitFamiliar, loading: submittingFamiliar } = useMatriculaFamiliarSubmit({
    onSuccess: (results) => {
      setFamiliarResults(results);
      // Trigger list refresh via onCompleted even for familiar (caller decides how to handle)
      const firstSuccess = results.find((r) => r.status === 'success');
      if (firstSuccess) {
        onCompleted?.({ matricula: { id: firstSuccess.matriculaId ?? '' } } as unknown as MatriculaCreatedPayload);
      }
    },
    onError: (error) => {
      console.error('[MatriculaWizardFlow] Erro ao criar matrículas familiares:', error);
    },
  });

  const isSubmitting = submitting || submittingFamiliar;

  useEffect(() => {
    const isOpen = open ?? true;
    const wasOpen = prevOpenRef.current ?? false;
    const contaChangedWhileOpen = isOpen && prevContaRef.current !== contaId;
    if ((isOpen && !wasOpen) || contaChangedWhileOpen) {
      wizard.reset({ contaId: contaId ?? '' });
    }
    prevOpenRef.current = isOpen;
    prevContaRef.current = contaId;
  }, [open, contaId, wizard]);

  const renderStep = useCallback(
    (ctx: WizardContextValue) => {
      switch (ctx.step) {
        case 'modo':
          return <StepModoMatricula ctx={ctx} />;
        case 'aluno':
          return <StepAluno ctx={ctx} contaId={contaId} />;
        case 'responsavelFamiliar':
          return <StepResponsavelFamiliar ctx={ctx} />;
        case 'alunosFamiliares':
          return <StepAlunosFamiliares ctx={ctx} contaId={contaId} />;
        case 'turmasCombo':
          return <StepTurmasCombo ctx={ctx} contaId={contaId} />;
        case 'taxa':
          return <StepTaxa ctx={ctx} />;
        case 'plano':
          return <StepPlano ctx={ctx} contaId={contaId} />;
        case 'bolsaBeneficios':
          return <StepBolsaBeneficios ctx={ctx} contaId={contaId} />;
        case 'jurosMulta':
          return <StepJurosMulta ctx={ctx} />;
        case 'notificacoes':
          return <StepNotificacoes ctx={ctx} />;
        case 'financeiro':
          return <StepFinanceiro ctx={ctx} />;
        case 'resumo':
          return <StepResumo ctx={ctx} />;
        default:
          return (
            <div className="py-10 text-center text-sm text-gray-500">Passo em construção.</div>
          );
      }
    },
    [contaId],
  );

  const stepIndex = wizard.steps.indexOf(wizard.step);
  const progress = ((stepIndex + 1) / wizard.steps.length) * 100;

  const canAdvance = useMemo(() => {
    const state = wizard.state;
    switch (wizard.step) {
      case 'modo':
        return canAdvanceFromModo(state);
      case 'aluno':
        return canAdvanceFromAluno(state);
      case 'responsavelFamiliar':
        return canAdvanceFromResponsavelFamiliar(state);
      case 'alunosFamiliares':
        return canAdvanceFromAlunosFamiliares(state);
      case 'turmasCombo':
        return canAdvanceFromTurmas(state);
      case 'taxa':
        return canAdvanceFromTaxa(state);
      case 'plano':
        return canAdvanceFromPlano(state);
      case 'jurosMulta':
        return true; // Step opcional, sempre permite avançar
      case 'bolsaBeneficios':
        return canAdvanceFromBolsaBeneficios(state);
      case 'notificacoes':
        return true;
      case 'financeiro':
        return canAdvanceFromFinanceiro(state);
      case 'resumo':
        return state.modoMatricula === 'FAMILIAR' ? canSubmitFamiliar(state) : canSubmit(state);
      default:
        return false;
    }
  }, [wizard.state, wizard.step]);

  const handleSubmit = useCallback(async () => {
    try {
      if (wizard.state.modoMatricula === 'FAMILIAR') {
        await submitFamiliar(wizard.state);
      } else {
        await submit(wizard.state);
      }
    } catch (error) {
      console.error('Erro ao submeter matrícula:', error);
    }
  }, [submit, submitFamiliar, wizard.state]);

  const handleNext = useCallback(async () => {
    if (!canAdvance || isSubmitting) return;
    if (wizard.step === 'resumo') {
      await handleSubmit();
      return;
    }
    wizard.goNext();
  }, [canAdvance, isSubmitting, wizard, handleSubmit]);

  const handleBack = useCallback(() => {
    if (wizard.step === 'modo') return;
    wizard.goBack();
  }, [wizard]);

  // Familiar results view after completion
  if (familiarResults) {
    const successCount = familiarResults.filter((r) => r.status === 'success').length;
    const errorCount = familiarResults.filter((r) => r.status === 'error').length;
    return (
      <div className="flex flex-col rounded-2xl bg-slate-50 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Matrículas processadas</h2>
          <p className="mt-1 text-sm text-slate-500">
            {successCount} criada{successCount !== 1 ? 's' : ''} com sucesso
            {errorCount > 0 ? `, ${errorCount} com erro` : ''}.
          </p>
        </div>

        <ul className="space-y-2">
          {familiarResults.map((r) => (
            <li
              key={r.alunoId}
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
                r.status === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <span className="font-medium flex-1">{r.alunoNome}</span>
              {r.status === 'success' ? (
                <span className="text-emerald-600 text-xs">Matrícula criada</span>
              ) : (
                <span className="text-red-600 text-xs">{r.errorMessage ?? 'Erro'}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setFamiliarResults(null);
              wizard.reset({ contaId: contaId ?? '' });
              onClose?.();
            }}
          >
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        variant === 'page'
          ? 'flex w-full flex-col rounded-2xl border border-slate-200 bg-slate-50 shadow-sm'
          : 'flex flex-col rounded-2xl bg-slate-50'
      }
      data-testid="matricula-wizard-flow"
    >
      <div className="relative rounded-t-2xl border-b border-slate-200 bg-slate-50 p-4 md:p-6">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Cadastrar matrícula</h2>
        <p className="mt-1 text-sm text-slate-600">Preencha os dados da matrícula em etapas.</p>
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
            <Progress
              value={progress}
              className="h-2 bg-transparent [&>div]:bg-gradient-to-r [&>div]:from-brand-accent [&>div]:to-brand-accent/70"
              aria-label="Progresso do cadastro de matrícula"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            />
          </div>
          <div className="mt-2 text-xs font-medium text-slate-600" aria-live="polite">
            Etapa {stepIndex + 1} de {wizard.steps.length}
          </div>
        </div>
      </div>

      <div
        className={
          variant === 'dialog'
            ? 'flex max-h-[78vh] flex-col'
            : 'flex flex-col'
        }
      >
        <div 
          className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent" 
          style={{ scrollbarWidth: 'thin', scrollbarGutter: 'stable', scrollbarColor: '#d1d5db transparent' }}
        >
          <div className="mx-auto w-full max-w-5xl space-y-6" id="wizard-step-content">
            {renderStep(wizard)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-4 md:p-6">
          {/* Área esquerda para botões extras (ex: Cadastrar aluno) */}
          <div className="flex items-center gap-3" id="wizard-left-actions">
            {/* Conteúdo injetado pelo step, se houver */}
          </div>

          {/* Área direita para navegação */}
          <div className="flex items-center gap-3">
            {wizard.step !== 'modo' && (
              <Button
                type="button"
                variant="outline"
                data-testid="wizard-back"
                onClick={handleBack}
                className="h-10 min-w-[140px] border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100"
              >
                Voltar
              </Button>
            )}
            <Button
              type="button"
              data-testid="wizard-next"
              className="h-10 min-w-[160px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
              disabled={!canAdvance || isSubmitting}
              onClick={handleNext}
            >
              {wizard.step === 'resumo' ? (isSubmitting ? 'Processando...' : 'Concluir') : 'Avançar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
