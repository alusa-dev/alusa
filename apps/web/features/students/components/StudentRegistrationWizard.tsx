'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { UnsavedChangesDialog } from '@/components/ui/UnsavedChangesDialog';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { useForm, FormProvider, type FieldPath } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImageCropDialog } from '@/components/image/ImageCropDialog';
import { alunoSchema, alunoWizardStepSchema, type AlunoInput } from '../../../../../prisma/zod/aluno';
import { WizardErrorVisibilityProvider } from '@/components/shared/wizard/fields';
import { SectionCard, StepHeader } from '@/components/shared/wizard/layout';
import IdentificationFields from '@/features/students/components/wizard/steps/IdentificationFields';
import AddressFields from '@/features/students/components/wizard/steps/AddressFields';
import HealthFields from '@/features/students/components/wizard/steps/HealthFields';
import ProfileFields from '@/features/students/components/wizard/steps/ProfileFields';
import PhotoFields from '@/features/students/components/wizard/steps/PhotoFields';
import ResponsiblePartyFields from '@/features/students/components/wizard/steps/ResponsiblePartyFields';
import ConfirmationSection from '@/features/students/components/wizard/steps/ConfirmationSection';
import {
  digits,
  parseMaybeDate,
  yearsDiff,
  buildStepFieldMap,
  focusFirstError,
} from '@/features/students/components/wizard/utils';

type StepId =
  | 'identificacao'
  | 'endereco'
  | 'saude'
  | 'perfil'
  | 'foto'
  | 'responsavel'
  | 'confirmar';
type WizardData = AlunoInput;

export interface StudentRegistrationWizardProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onFinish?: () => void;
  contaId?: string | null;
}

export default function StudentRegistrationWizard({
  open,
  onOpenChange,
  onFinish,
  contaId,
}: StudentRegistrationWizardProps) {
  // --- VISUAL STATE (não afeta lógica de formulário) ---
  const resolvedContaId = React.useMemo(() => {
    if (typeof contaId === 'string' && contaId.trim().length > 0) return contaId;
    return null;
  }, [contaId]);

  const methods = useForm<WizardData>({
    resolver: zodResolver(alunoSchema),
    defaultValues: {
      status: 'ATIVO',
      responsavel: null,
      consentimentoComunicacoes: false,
      consentimentoMarketing: false,
      responsavelModo: 'existente',
      responsavelExistenteId: null,
    } as Partial<WizardData>,
    mode: 'onBlur',
  });

  const [confirmClose, setConfirmClose] = React.useState(false);
  const [errorsVisible, setErrorsVisible] = React.useState(false);
  const [foto, setFoto] = React.useState<string>('');
  const [cropSource, setCropSource] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const missingContaWarnedRef = React.useRef(false);
  const [minorToastShown, setMinorToastShown] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const dataNascWatch = methods.watch('dataNasc');
  const birth = parseMaybeDate(dataNascWatch);
  const isMinor = birth ? yearsDiff(birth) < 18 : false;

  const steps: { id: StepId; label: string }[] = React.useMemo(() => {
    const base: { id: StepId; label: string }[] = [
      { id: 'identificacao', label: 'Identificação' },
      { id: 'endereco', label: 'Endereço' },
      { id: 'saude', label: 'Saúde & Emergência' },
      { id: 'perfil', label: 'Perfil' },
      { id: 'foto', label: 'Foto' },
    ];
    if (isMinor) base.push({ id: 'responsavel', label: 'Responsável' });
    base.push({ id: 'confirmar', label: 'Confirmação' });
    return base;
  }, [isMinor]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const activeStep = steps[activeIndex].id;

  const [cropOpen, setCropOpen] = React.useState(false);

  React.useEffect(() => {
    setErrorsVisible(false);
    if (!open) return;
    methods.reset({
      contaId: resolvedContaId ?? undefined,
      status: 'ATIVO',
      responsavelModo: 'existente',
      responsavelExistenteId: null,
      responsavel: null,
      consentimentoComunicacoes: false,
      consentimentoMarketing: false,
    } as Partial<WizardData>);
    setFoto('');
    setCropSource(null);
    setCropOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveIndex(0);
    setMinorToastShown(false);
  }, [open, methods, resolvedContaId]);

  const notifyError = React.useCallback((message: string) => {
    try {
      window.dispatchEvent(new CustomEvent('toast:error', { detail: { message } }));
    } catch {
      /* noop */
    }
  }, []);

  React.useEffect(() => {
    if (!open) {
      missingContaWarnedRef.current = false;
      return;
    }
    if (resolvedContaId) {
      missingContaWarnedRef.current = false;
      return;
    }
    if (!missingContaWarnedRef.current) {
      notifyError(
        'Não foi possível identificar a conta ativa. Faça login novamente e tente de novo.',
      );
      missingContaWarnedRef.current = true;
    }
  }, [open, resolvedContaId, notifyError]);

  React.useEffect(() => {
    if (isMinor && !minorToastShown) {
      try {
        window.dispatchEvent(
          new CustomEvent('toast:info', {
            detail: { message: 'Aluno menor de 18 anos. Será necessário informar um responsável.' },
          }),
        );
      } catch {
        /* noop */
      }
      setMinorToastShown(true);
    }
  }, [isMinor, minorToastShown]);

  function requestClose(next: boolean) {
    if (submitting) return;
    if (next === false && open) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  }
  const stepFields = React.useMemo(() => buildStepFieldMap(isMinor), [isMinor]);
  function canGoPrev() {
    return activeIndex > 0;
  }
  function goPrev() {
    if (canGoPrev()) {
      setErrorsVisible(false);
      setActiveIndex((i) => i - 1);
    }
  }
  async function goNext() {
    setErrorsVisible(true);
    const fields = stepFields[activeStep] as unknown as (keyof WizardData)[];
    const fieldsAsStrings = fields as readonly string[];
    const ok = fields.length ? await methods.trigger(fields) : true;

    // O resolver do RHF pode validar somente os campos solicitados e não
    // materializar issues produzidos pelo superRefine do schema completo.
    // Revalidamos o mesmo contrato canônico e projetamos apenas os erros da
    // etapa atual, sem duplicar regras condicionais no wizard.
    const schemaResult = alunoWizardStepSchema.safeParse(methods.getValues());
    const currentStepIssues = schemaResult.success
      ? []
      : schemaResult.error.issues.filter((issue) => {
          const path = issue.path.join('.');
          return fieldsAsStrings.includes(path) || fieldsAsStrings.includes(String(issue.path[0]));
        });

    if (!ok || currentStepIssues.length > 0) {
      for (const issue of currentStepIssues) {
        const fieldPath = issue.path.join('.') as FieldPath<WizardData>;
        methods.setError(fieldPath, { type: 'schema', message: issue.message });
      }
      focusFirstError(methods.formState.errors);
      return;
    }
    setErrorsVisible(false);
    setActiveIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function submitAll() {
    if (submitting) return;
    setErrorsVisible(true);
    if (!resolvedContaId) {
      notifyError('Não foi possível identificar a conta do cadastro.');
      return;
    }
    const ok = await methods.trigger();
    if (!ok) {
      const errors = methods.formState.errors;

      // Mostrar mensagem específica para erro de responsável
      if (errors.responsavel) {
        notifyError(
          'Dados do responsável são obrigatórios para aluno menor de 18 anos. Preencha a etapa "Responsável".',
        );
        // Ir para o step de responsável se existir
        const responsavelStepIndex = steps.findIndex((s) => s.id === 'responsavel');
        if (responsavelStepIndex !== -1) {
          setActiveIndex(responsavelStepIndex);
          return;
        }
      }

      // Para outros erros, ir para o primeiro step com erro
      const firstErrorField = Object.keys(errors)[0];
      const errorMessage = errors[firstErrorField as keyof typeof errors]?.message;
      if (errorMessage) {
        notifyError(`Erro no formulário: ${errorMessage}`);
      } else {
        notifyError('Há campos obrigatórios não preenchidos. Verifique todos os passos.');
      }

      setActiveIndex(0);
      focusFirstError(errors);
      return;
    }
    const values = methods.getValues();
    try {
      setSubmitting(true);
      const payload: Record<string, unknown> = {
        ...values,
        contaId: resolvedContaId,
        cpf: digits(values.cpf),
        telefone: digits(values.telefone),
        contatoEmergenciaTelefone: digits(values.contatoEmergenciaTelefone),
        enderecoCep: digits(values.enderecoCep),
      };
      if (foto) payload.foto = foto;
      const res = await fetch('/api/alunos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao salvar' }));
        notifyError(data.error || 'Erro ao salvar');
        return;
      }
      try {
        window.dispatchEvent(
          new CustomEvent('toast:success', { detail: { message: 'Aluno cadastrado com sucesso' } }),
        );
      } catch {
        /* noop */
      }
      try {
        window.dispatchEvent(new CustomEvent('alunos:changed'));
      } catch {
        /* noop */
      }
      onFinish?.();
      setTimeout(() => onOpenChange(false), 60);
    } catch {
      notifyError('Erro de comunicação');
    } finally {
      setSubmitting(false);
    }
  }

  const handleFileInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const MAX_BYTES = 5 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        notifyError('Arquivo excede o limite de 5MB.');
        event.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result) {
          notifyError('Não foi possível carregar a foto.');
          return;
        }
        setCropSource(result);
        setCropOpen(true);
      };
      reader.onerror = () => {
        notifyError('Não foi possível carregar a foto.');
      };
      reader.readAsDataURL(file);
      event.target.value = '';
    },
    [notifyError],
  );
  const handlePickPhoto = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handleEditPhoto = React.useCallback(() => {
    if (!foto) {
      handlePickPhoto();
      return;
    }
    setCropSource(foto);
    setCropOpen(true);
  }, [foto, handlePickPhoto]);
  const handleRemovePhoto = React.useCallback(() => {
    setFoto('');
    setCropSource(null);
    setCropOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);
  const handleCropApply = React.useCallback((res: { dataUrl: string }) => {
    setFoto(res.dataUrl);
    setCropSource(null);
    setCropOpen(false);
  }, []);
  const handleCropClose = React.useCallback(() => {
    setCropOpen(false);
    setCropSource(null);
  }, []);

  const nomeWatch = methods.watch('nome');
  const nomeSocialWatch = methods.watch('nomeSocial');
  const avatarFallback = React.useMemo(() => {
    const base = (nomeWatch || nomeSocialWatch || '').trim();
    if (!base) return 'AL';
    const parts = base.split(/\s+/).filter(Boolean);
    const [first, second] = parts;
    const initials = `${first?.[0] ?? ''}${second?.[0] ?? ''}`.toUpperCase();
    return initials || (first?.[0] ?? 'A').toUpperCase();
  }, [nomeWatch, nomeSocialWatch]);

  React.useEffect(() => {
    type W = Window & { __alunoDraftTimer?: number };
    const subscription = methods.watch(() => {
      const w = window as W;
      if (w.__alunoDraftTimer) clearTimeout(w.__alunoDraftTimer);
      w.__alunoDraftTimer = window.setTimeout(() => {
        try {
          const values = methods.getValues();
          const draft: Record<string, unknown> = { ...values };
          if (foto) draft.__fotoDataUrl = foto;
          else delete draft.__fotoDataUrl;
          localStorage.setItem('alunoWizardDraft', JSON.stringify(draft));
        } catch {
          /* noop */
        }
      }, 300);
    }) as unknown as { unsubscribe: () => void };
    return () => subscription.unsubscribe();
  }, [methods, foto]);

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        fullScreenMobile
        closeDisabled={submitting}
        overlayClass="alusa-registration-wizard-overlay"
        className={`aluno-registration-wizard flex max-w-[1020px] w-full flex-col rounded-[20px] gap-0 overflow-hidden bg-white p-0 alusa-dark:bg-[color:var(--color-bg-card)] sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0 ${activeStep === 'confirmar' ? 'md:h-[min(640px,calc(100dvh-2rem))] md:min-h-0' : 'md:min-h-[492px]'}`}
        data-testid="aluno-wizard"
      >
        <div inert={submitting || undefined} className="relative shrink-0 bg-white pb-5 pl-8 pr-10 pt-8 alusa-dark:bg-[color:var(--color-bg-card-soft)] max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="pr-2 text-xl font-normal tracking-tight text-[#0f0f0f] md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
                Cadastrar aluno
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-sm text-[#5c5c5c] alusa-dark:text-[color:var(--color-text-secondary)]">
                Preencha os dados do aluno em etapas.
              </DialogDescription>
            </div>
          </div>
            <div className="mt-3">
            <div className="h-[10px] w-full overflow-hidden rounded-full bg-[#eff3f8] alusa-dark:bg-[color:var(--color-border-default)]">
              <Progress
                value={((activeIndex + 1) / steps.length) * 100}
                className="h-[10px] bg-transparent [&>div]:bg-[#512a82]"
                aria-label="Progresso do cadastro do aluno"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(((activeIndex + 1) / steps.length) * 100)}
              />
            </div>
            <div
              className="sr-only"
              aria-live="polite"
              data-testid="wizard-progress-text"
            >
              Etapa {activeIndex + 1} de {steps.length}
            </div>
          </div>
        </div>
        <FormProvider {...methods}>
          <WizardErrorVisibilityProvider visible={errorsVisible}>
            <div inert={submitting || undefined} className="flex min-h-0 flex-1 flex-col overflow-x-clip max-md:max-h-none">
            <div
              className={`flex-1 overflow-x-clip bg-white pb-6 pl-8 pr-10 pt-3 alusa-dark:bg-[color:var(--color-bg-card-soft)] max-md:min-h-0 max-md:overflow-x-hidden max-md:overflow-y-auto max-md:p-4 ${activeStep === 'confirmar' ? 'md:min-h-0 md:overflow-x-hidden md:overflow-y-auto' : ''}`}
            >
              <div className="mx-auto w-full max-w-5xl">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="space-y-6 w-full overflow-x-hidden"
                  >
                    <StepHeader title={steps[activeIndex]?.label ?? 'Identificação'} />
                    {activeStep === 'identificacao' && (
                      <SectionCard variant="open">
                        <IdentificationFields />
                      </SectionCard>
                    )}
                    {activeStep === 'endereco' && (
                      <SectionCard variant="open">
                        <AddressFields />
                      </SectionCard>
                    )}
                    {activeStep === 'saude' && (
                      <SectionCard variant="open">
                        <HealthFields />
                      </SectionCard>
                    )}
                    {activeStep === 'perfil' && (
                      <SectionCard variant="open">
                        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                          Campos de categorização interna e consentimentos.
                        </p>
                        <ProfileFields />
                      </SectionCard>
                    )}
                    {activeStep === 'foto' && (
                      <SectionCard variant="open">
                        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                          Facilita identificação em listas e matrículas (Opcional).
                        </p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileInputChange}
                        />
                        <PhotoFields
                          fotoPreview={foto ? foto : null}
                          avatarFallback={avatarFallback}
                          onEdit={handleEditPhoto}
                          onReplace={handlePickPhoto}
                          onRemove={handleRemovePhoto}
                        />
                      </SectionCard>
                    )}
                    {activeStep === 'responsavel' && isMinor && (
                      <SectionCard variant="open">
                        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                          Obrigatório para menores de 18 anos.
                        </p>
                        <ResponsiblePartyFields />
                      </SectionCard>
                    )}
                    {activeStep === 'confirmar' && (
                      <SectionCard variant="open">
                        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                          Revise cuidadosamente antes de concluir.
                        </p>
                        <ConfirmationSection all={methods.getValues()} fotoPreview={foto || null} />
                      </SectionCard>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <div className="flex shrink-0 flex-col-reverse items-stretch gap-2 bg-white pb-8 pl-8 pr-10 pt-4 alusa-dark:bg-[color:var(--color-bg-card-soft)] max-md:p-4 md:flex-row md:items-center md:justify-end md:gap-3">
              <Button
                type="button"
                variant="wizardSecondary"
                onClick={goPrev}
                disabled={!canGoPrev() || submitting}
                className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] bg-[#eff3f8] px-5 font-normal text-[#303030] shadow-none hover:bg-[#eff3f8] max-md:w-full alusa-dark:text-[color:var(--color-text-primary)]"
                data-testid="wizard-prev"
              >
                Voltar
              </Button>
              {activeStep !== 'confirmar' ? (
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={submitting}
                  variant="wizardPrimary"
                  className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] bg-[#512a82] px-5 font-normal text-white hover:bg-[#512a82] max-md:w-full disabled:opacity-60"
                  data-testid="wizard-next"
                >
                  Avançar
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submitAll}
                  disabled={submitting}
                  variant="wizardPrimary"
                  className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] bg-[#512a82] px-5 font-normal text-white hover:bg-[#512a82] max-md:w-full disabled:opacity-60"
                  data-testid="aluno-concluir"
                >
                  Concluir
                </Button>
              )}
            </div>
            </div>
          </WizardErrorVisibilityProvider>
        </FormProvider>
        <UnsavedChangesDialog
          open={confirmClose}
          onOpenChange={setConfirmClose}
          className="alusa-wizard-corner-smoothing"
          onDiscard={() => {
            setConfirmClose(false);
            onOpenChange(false);
          }}
        />
        <ImageCropDialog
          className="alusa-wizard-corner-smoothing"
          src={cropSource}
          open={cropOpen && Boolean(cropSource)}
          onOpenChange={(o) => {
            if (!o) handleCropClose();
            else setCropOpen(true);
          }}
          onApply={handleCropApply}
          aspect={1}
          title="Ajustar corte"
          round
        />
        {submitting && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/15" aria-busy="true">
            <LoadingDots />
          </div>
        )}
        <style jsx global>{`
          .aluno-registration-wizard {
            --wizard-field-background: #eff3f8;
            --wizard-field-hover-background: #e7edf5;
            --wizard-field-text: #30333b;
            --wizard-field-placeholder: #8a9bb2;
            --wizard-label-text: #25232a;
          }

          [data-theme='dark'] .aluno-registration-wizard {
            --wizard-field-background: var(--color-bg-elevated);
            --wizard-field-hover-background: color-mix(in srgb, var(--color-bg-elevated) 93%, white);
            --wizard-field-text: var(--color-input-text);
            --wizard-field-placeholder: var(--color-input-placeholder);
            --wizard-label-text: var(--color-text-primary);
          }

          .aluno-registration-wizard .alusa-wizard-fields label {
            color: var(--wizard-label-text);
            font-size: 12px;
            font-weight: 500;
            line-height: 16px;
          }

          .aluno-registration-wizard [data-required-marker] {
            display: none;
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input {
            height: 40px;
            border: 0;
            border-radius: 10px;
            background-color: var(--wizard-field-background);
            color: var(--wizard-field-text);
            font-size: 13px;
            line-height: 20px;
            padding-left: 12px;
            padding-right: 12px;
            transition: background-color 140ms ease-out;
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input::placeholder {
            color: var(--wizard-field-placeholder);
            opacity: 1;
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-date-field .wizard-field-input {
            padding-right: 40px;
          }

          .aluno-registration-wizard .alusa-wizard-fields .alusa-select-trigger [data-placeholder] {
            color: var(--wizard-field-placeholder);
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input--cep-status {
            padding-right: 48px !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields input.wizard-field-input:-webkit-autofill,
          .aluno-registration-wizard .alusa-wizard-fields input.wizard-field-input:-webkit-autofill:hover,
          .aluno-registration-wizard .alusa-wizard-fields input.wizard-field-input:autofill {
            background-color: var(--wizard-field-background) !important;
            -webkit-box-shadow: 0 0 0 1000px var(--wizard-field-background) inset !important;
            box-shadow: none !important;
            -webkit-text-fill-color: var(--wizard-field-text) !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields input.wizard-field-input:-webkit-autofill:focus,
          .aluno-registration-wizard .alusa-wizard-fields input.wizard-field-input:autofill:focus {
            background-color: transparent !important;
            -webkit-box-shadow: inset 0 0 0 1000px transparent, inset 0 0 0 1px #9ca3af !important;
            box-shadow: inset 0 0 0 1px #9ca3af !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields .alusa-select-trigger {
            background-color: var(--wizard-field-background) !important;
            border: 0 !important;
            color: var(--wizard-field-text);
            transition: background-color 140ms ease-out;
          }

          /* Progressive enhancement: preserve the current radius as fallback,
             and use a restrained superellipse where corner-shape is supported. */
          @supports (corner-shape: superellipse(1.1)) {
            .aluno-registration-wizard,
            .aluno-registration-wizard :not(.rounded-full),
            .alusa-wizard-corner-smoothing,
            .alusa-wizard-corner-smoothing :not(.rounded-full) {
              corner-shape: superellipse(1.1);
            }
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input--required-empty,
          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input--error {
            box-shadow: none !important;
            padding-right: 48px !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields .alusa-select-trigger.wizard-field-input--required-empty,
          .aluno-registration-wizard .alusa-wizard-fields .alusa-select-trigger.wizard-field-input--error {
            padding-right: 48px !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-date-field:has(.wizard-field-input--required-empty) > div:last-child,
          .aluno-registration-wizard .alusa-wizard-fields .wizard-date-field:has(.wizard-field-input--error) > div:last-child {
            right: 3rem;
          }

          [data-theme='dark'] .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input--required-empty,
          [data-theme='dark'] .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input--error {
            box-shadow: none !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields .wizard-field-input:not(.wizard-field-input--error):is(:focus, [data-state='open']) {
            background-color: transparent !important;
            box-shadow: inset 0 0 0 1px #9ca3af !important;
            outline: none !important;
          }

          .aluno-registration-wizard .alusa-wizard-fields .alusa-select-trigger:not(.wizard-field-input--error):is(:focus, [data-state='open']) {
            background-color: transparent !important;
            box-shadow: inset 0 0 0 1px #9ca3af !important;
            outline: none !important;
          }

        `}</style>
      </DialogContent>
    </Dialog>
  );
}
