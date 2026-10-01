'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Button } from '@/components/ui/button';
import { StepStudent } from './wizard/steps/StepStudent';
import { StepEnrollmentMode } from './wizard/steps/StepEnrollmentMode';
import { StepFamilyResponsibleParty } from './wizard/steps/StepFamilyResponsibleParty';
import { StepFamilyStudents } from './wizard/steps/StepFamilyStudents';
import { StepClassesAndBundle } from './wizard/steps/StepClassesAndBundle';
import { StepPlan } from './wizard/steps/StepPlan';
import { StepBolsaBeneficios } from './wizard/steps/StepBolsaBeneficios';
import { StepJurosMulta } from './wizard/steps/StepJurosMulta';
import { StepNotifications } from './wizard/steps/StepNotifications';
import { StepFinanceiro } from './wizard/steps/StepFinanceiro';
import { StepSummary } from './wizard/steps/StepSummary';
import { StepTaxa } from './wizard/steps/StepTaxa';
import { useEnrollmentWizard } from './wizard/hooks/useEnrollmentWizard';
import type { WizardContextValue, WizardState } from './wizard/types';
import type { MatriculaCreatedPayload } from '@/features/enrollments/services/enrollments-service';
import { useMatriculaSubmit } from '@/hooks/use-matricula-submit';
import { useMatriculaFamiliarSubmit } from '@/hooks/use-matricula-familiar-submit';
import { FamilyEnrollmentWizardOutcome } from './FamilyEnrollmentWizardOutcome';
import type { FamilyEnrollmentOutcome } from './wizard/types';
import { toast, CustomToast } from '@/components/ui/toast';

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
  if (alunos.length < 1) return false;
  // All active alunos must have turma or combo selected
  return alunos.every((a) => {
    if (a.ativo === false) return false;
    if (state.modoTurmas === 'COMBO') return Boolean(a.comboId);
    return Boolean(a.turmaId);
  });
}

function canSubmitFamiliar(state: WizardState) {
  if (!state.responsavelFamiliar?.id) return false;
  if (state.alunosFamiliares.length < 1) return false;
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
  const dueDayIsValid =
    typeof state.vencimentoDia === 'number' &&
    Number.isInteger(state.vencimentoDia) &&
    state.vencimentoDia >= 1 &&
    state.vencimentoDia <= 28;

  return Boolean(
    state.formaPagamento &&
    state.dataInicio &&
    state.dataFimContrato &&
    state.modeloId &&
    dueDayIsValid,
  );
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

export function EnrollmentWizardFlow({
  contaId,
  open,
  variant = 'dialog',
  onClose,
  onCompleted,
}: MatriculaWizardFlowProps) {
  const wizard = useEnrollmentWizard(contaId);
  const prevOpenRef = useRef<boolean | undefined>(open);
  const prevContaRef = useRef<string | undefined>(contaId);
  const [familyOutcome, setFamilyOutcome] = useState<FamilyEnrollmentOutcome | null>(null);

  // Hook de submissão de matrícula
  const { submit, loading: submitting } = useMatriculaSubmit({
    redirectOnSuccess: false, // Não redirecionar, usar callback
    onSuccess: (result) => {
      wizard.reset({ contaId: contaId ?? '' });
      onClose?.();
      onCompleted?.(result as unknown as MatriculaCreatedPayload);
    },
    onError: (error) => {
      console.error('[EnrollmentWizardFlow] Erro ao criar matrícula:', error);
    },
  });

  const { submit: submitFamiliar, loading: submittingFamiliar } = useMatriculaFamiliarSubmit({
    onSuccess: (outcome) => {
      setFamilyOutcome(outcome);
    },
    onError: (error) => {
      console.error('[EnrollmentWizardFlow] Erro ao criar matrículas familiares:', error);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Matrícula familiar não concluída"
          description={error.message || 'Nenhuma matrícula ou cobrança foi criada.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    },
  });

  const isSubmitting = submitting || submittingFamiliar;

  useEffect(() => {
    const isOpen = open ?? true;
    const wasOpen = prevOpenRef.current ?? false;
    const contaChangedWhileOpen = isOpen && prevContaRef.current !== contaId;
    if ((isOpen && !wasOpen) || contaChangedWhileOpen) {
      setFamilyOutcome(null);
      wizard.reset({ contaId: contaId ?? '' });
    }
    prevOpenRef.current = isOpen;
    prevContaRef.current = contaId;
  }, [open, contaId, wizard]);

  const renderStep = useCallback(
    (ctx: WizardContextValue) => {
      switch (ctx.step) {
        case 'modo':
          return <StepEnrollmentMode ctx={ctx} />;
        case 'aluno':
          return <StepStudent ctx={ctx} contaId={contaId} />;
        case 'responsavelFamiliar':
          return <StepFamilyResponsibleParty ctx={ctx} />;
        case 'alunosFamiliares':
          return <StepFamilyStudents ctx={ctx} contaId={contaId} />;
        case 'turmasCombo':
          return <StepClassesAndBundle ctx={ctx} contaId={contaId} />;
        case 'taxa':
          return <StepTaxa ctx={ctx} />;
        case 'plano':
          return <StepPlan ctx={ctx} contaId={contaId} />;
        case 'bolsaBeneficios':
          return <StepBolsaBeneficios ctx={ctx} contaId={contaId} />;
        case 'jurosMulta':
          return <StepJurosMulta ctx={ctx} />;
        case 'notificacoes':
          return <StepNotifications ctx={ctx} />;
        case 'financeiro':
          return <StepFinanceiro ctx={ctx} />;
        case 'resumo':
          return <StepSummary ctx={ctx} />;
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

  if (familyOutcome) {
    const firstSuccess = familyOutcome.results.find((result) => result.status === 'success');
    return (
      <FamilyEnrollmentWizardOutcome
        onClose={() => {
          if (firstSuccess) {
            onCompleted?.({
              matricula: { id: firstSuccess.matriculaId ?? '' },
            } as unknown as MatriculaCreatedPayload);
          }
          setFamilyOutcome(null);
          onClose?.();
        }}
      />
    );
  }

  return (
    <div
      className={
        variant === 'page'
          ? 'enrollment-wizard-flow relative flex w-full flex-col rounded-2xl border border-slate-200 bg-slate-50 shadow-sm'
          : 'enrollment-wizard-flow relative flex min-h-0 flex-1 flex-col bg-[#f8fafc] alusa-dark:bg-[color:var(--color-bg-card)]'
      }
      data-testid="matricula-wizard-flow"
      aria-busy={isSubmitting}
    >
      <div
        inert={isSubmitting || undefined}
        className={
          variant === 'dialog'
            ? 'relative bg-[#f8fafc] px-4 pb-3 pt-4 alusa-dark:bg-[color:var(--color-bg-card)] max-md:pb-3 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5'
            : 'relative rounded-t-2xl border-b border-slate-200 bg-slate-50 p-4 md:p-6'
        }
      >
        {variant === 'page' ? (
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
        ) : null}
        <h2
          className="pr-2 text-xl font-semibold tracking-tight text-slate-900 alusa-dark:text-[color:var(--color-text-primary)] md:pr-0"
          aria-hidden={variant === 'dialog' ? true : undefined}
        >
          Cadastrar matrícula
        </h2>
        <p
          className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]"
          aria-hidden={variant === 'dialog' ? true : undefined}
        >
          Preencha os dados da matrícula em etapas.
        </p>
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
            <Progress
              value={progress}
              className="h-2 bg-transparent [&>div]:bg-[#512a82]"
              aria-label="Progresso do cadastro de matrícula"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            />
          </div>
        </div>
      </div>

      <div
        inert={isSubmitting || undefined}
        className={
          variant === 'dialog' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex flex-col'
        }
      >
        <div
          className={`flex-1 overflow-y-auto bg-[#f8fafc] px-4 py-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5 max-md:min-h-0 ${variant === 'dialog' ? 'scroll-smooth' : ''}`}
          style={{
            scrollbarWidth: 'thin',
            scrollbarGutter: 'stable',
            scrollbarColor: '#d1d5db transparent',
          }}
        >
          <div className="mx-auto w-full max-w-4xl space-y-4" id="wizard-step-content">
            {renderStep(wizard)}
          </div>
        </div>
        <div
          className={
            variant === 'dialog'
              ? 'flex shrink-0 flex-col-reverse gap-3 bg-[#f8fafc] px-4 py-3 alusa-dark:bg-[color:var(--color-bg-card)] md:flex-row md:items-center md:justify-between md:gap-3 md:px-6 md:py-4'
              : 'flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-4 md:p-6'
          }
        >
          <div
            className="flex max-md:w-full items-center gap-3 md:w-auto"
            id="wizard-left-actions"
          />
          <div
            className={
              variant === 'dialog'
                ? 'flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end md:w-auto'
                : 'flex items-center gap-3'
            }
          >
            {wizard.step !== 'modo' && (
              <Button
                type="button"
                variant="outline"
                data-testid="wizard-back"
                onClick={handleBack}
                className={
                  variant === 'dialog'
                    ? 'h-11 min-h-11 w-full rounded-[10px] border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50 sm:w-auto md:h-10 md:min-h-0'
                    : 'h-10 min-w-[140px] border-slate-200 bg-white text-slate-600 shadow-none hover:bg-slate-100'
                }
              >
                Voltar
              </Button>
            )}
            <Button
              type="button"
              data-testid="wizard-next"
              className={
                variant === 'dialog'
                  ? 'h-11 min-h-11 w-full rounded-[10px] bg-[#512a82] px-5 text-white shadow-none hover:bg-[#45236f] sm:w-auto md:h-10 md:min-h-0 md:min-w-[160px]'
                  : 'h-10 min-w-[160px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90'
              }
              disabled={!canAdvance || isSubmitting}
              onClick={handleNext}
            >
              {wizard.step === 'resumo'
                ? isSubmitting
                  ? 'Processando...'
                  : 'Concluir'
                : 'Avançar'}
            </Button>
          </div>
        </div>
      </div>
      {isSubmitting && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/15">
          <LoadingDots label="Processando matrícula e configurando cobranças" />
        </div>
      )}
    </div>
  );
}
