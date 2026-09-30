/* eslint-disable */
'use client';
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UnsavedChangesDialog } from '@/components/ui/UnsavedChangesDialog';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Progress } from '@/components/ui/progress';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession } from 'next-auth/react';

import {
  StepHeader,
  SectionCard,
  IdentificationFields,
  AddressFields,
  EmploymentFields,
  ConfirmationSection,
  buildStepFieldMap,
  digits,
  focusFirstError,
  WizardErrorVisibilityProvider,
} from './wizard';
import { isValidCPF, isValidTelefone, isValidCEP } from './wizard/validators';
import PhotoFields from './wizard/steps/PhotoFields';
import { useDropzone } from 'react-dropzone';
import { ImageCropDialog } from '@/components/image/ImageCropDialog';
// Resize/compress util para fotos (mantém qualidade razoável e reduz payload)
async function resizeImageToDataURL(file: File, maxSize = 400, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = Math.max(width, height);
        if (maxDim > maxSize) {
          const scale = maxSize / maxDim;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Contexto canvas indisponível');
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mime, quality);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem para resize'));
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
  });
}

// Import direto do source da lib (até build/export estável)
import {
  colaboradorSchema,
  type ColaboradorInput,
} from '@alusa/lib/schemas/colaborador';

type StepId = 'identificacao' | 'endereco' | 'vinculo' | 'foto' | 'confirmar';

export interface EmployeeWizardDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onFinish?: () => void;
  contaId?: string;
}

export default function EmployeeWizardDialog({
  open,
  onOpenChange,
  onFinish,
  contaId,
}: EmployeeWizardDialogProps) {
  const { data: session } = useSession();
  const resolvedContaId = React.useMemo(() => {
    if (typeof contaId === 'string' && contaId.trim().length > 0) {
      return contaId;
    }
    const sessionContaId = (session?.user as { contaId?: string } | undefined)?.contaId;
    if (typeof sessionContaId === 'string' && sessionContaId.trim().length > 0) {
      return sessionContaId;
    }
    return null;
  }, [contaId, session]);
  const methods = useForm<ColaboradorInput>({
    resolver: zodResolver(colaboradorSchema),
    defaultValues: {
      status: 'ATIVO',
      cargo: 'RECEPCAO',
      temAcesso: false,
    } as Partial<ColaboradorInput>,
    mode: 'onBlur',
  });

  // confirmação de saída
  const [confirmClose, setConfirmClose] = React.useState(false);
  function requestClose(next: boolean) {
    if (submitting) return;
    if (next === false && open) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  }
  // steps
  const steps: { id: StepId; label: string }[] = React.useMemo(
    () => [
      { id: 'identificacao', label: 'IDENTIFICAÇÃO' },
      { id: 'endereco', label: 'ENDEREÇO' },
      { id: 'vinculo', label: 'VÍNCULO' },
      { id: 'foto', label: 'FOTO' },
      { id: 'confirmar', label: 'CONFIRMAR' },
    ],
    [],
  );

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [errorsVisible, setErrorsVisible] = React.useState(false);
  const activeStep = steps[activeIndex]?.id ?? 'identificacao';
  const [submitting, setSubmitting] = React.useState(false);
  const stepFields = React.useMemo(() => buildStepFieldMap(), []);
  // Pré-registra todos os campos para garantir que o resolver valide mesmo sem visitar a etapa
  React.useEffect(() => {
    const allFields = Object.values(stepFields).flat();
    for (const n of allFields) {
      const name = String(n) as keyof ColaboradorInput & string;
      methods.register(name);
    }
  }, []);

  // Foto local (preview)
  const [fotoFile, setFotoFile] = React.useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = React.useState<string | null>(null);
  const [cropOpen, setCropOpen] = React.useState(false);
  const missingContaWarnedRef = React.useRef(false);
  React.useEffect(() => {
    if (!fotoFile) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(fotoFile);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [fotoFile]);
  const onDrop = React.useCallback((accepted: File[]) => {
    if (!accepted || !accepted[0]) return;
    const file = accepted[0];
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_BYTES) {
      try {
        window.dispatchEvent(
          new CustomEvent('toast:error', {
            detail: { message: 'Arquivo excede o limite de 5MB.' },
          }),
        );
      } catch {
        /* noop */
      }
      return;
    }
    setFotoFile(file);
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    accept: { 'image/*': [] },
  });

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
    if (open) {
      setErrorsVisible(false);
      methods.reset({
        status: 'ATIVO',
        cargo: 'RECEPCAO',
        temAcesso: false,
      } as Partial<ColaboradorInput>);
      setActiveIndex(0);
      setCropOpen(false);
    }
  }, [open, methods]);

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
    const id = activeStep;
    const fields = stepFields[id] as unknown as (keyof ColaboradorInput)[];
    if (fields.length > 0) {
      const ok = await methods.trigger(fields);
      if (!ok) {
        focusFirstError(methods.formState.errors);
        return;
      }
    }
    setErrorsVisible(false);
    setActiveIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function submitAll() {
    if (submitting) return;
    setErrorsVisible(true);
    // 1) Garante validação pelo RHF (campos registrados)
    const ok = await methods.trigger();
    if (!ok) {
      setActiveIndex(0);
      focusFirstError(methods.formState.errors);
      return;
    }

    // 2) Validação extra com Zod do objeto completo (mesmo que algum campo não tenha sido montado)
    const values = methods.getValues();
    const parsed = colaboradorSchema.safeParse(values);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first ? `${first.path.join('.')}: ${first.message}` : 'Dados inválidos';
      try {
        window.dispatchEvent(new CustomEvent('toast:error', { detail: { message: msg } }));
      } catch {
        /* noop */
      }
      // Tenta navegar para a etapa correspondente ao primeiro campo com erro
      const field = first?.path?.[0] as keyof ColaboradorInput | undefined;
      if (field) {
        // Descobre etapa alvo a partir do mapa de campos por etapa
        const stepId = (Object.entries(stepFields).find(([, fields]) =>
          (fields as unknown as string[]).includes(field as unknown as string),
        )?.[0] ?? 'identificacao') as StepId;
        const idx = ['identificacao', 'endereco', 'vinculo', 'foto', 'confirmar'].indexOf(stepId);
        if (idx >= 0) setActiveIndex(idx);
      } else {
        setActiveIndex(0);
      }
      focusFirstError(methods.formState.errors);
      return;
    }
    // Usa valores validados como base
    const safeValues = parsed.data;

    // Validações extras do lado do cliente
    if (values.cpf && !isValidCPF(values.cpf)) {
      notifyError('CPF inválido. Verifique os números digitados.');
      setActiveIndex(0); // Volta para a primeira etapa
      return;
    }

    if (values.telefone1 && !isValidTelefone(values.telefone1)) {
      notifyError('Telefone inválido. Use o formato (00) 00000-0000.');
      setActiveIndex(0); // Volta para a primeira etapa
      return;
    }

    if (values.enderecoCep && !isValidCEP(values.enderecoCep)) {
      notifyError('CEP inválido. Use o formato 12345-678.');
      setActiveIndex(1); // Volta para a etapa de endereço
      return;
    }

    if (!resolvedContaId) {
      notifyError('Não foi possível identificar a conta do cadastro.');
      return;
    }

    try {
      setSubmitting(true);
      const payload: Record<string, unknown> = {
        ...safeValues,
        cpf: digits(values.cpf || undefined),
        telefone1: digits(values.telefone1 || undefined),
        enderecoCep: digits(values.enderecoCep || undefined),
      };
      // Utilitário robusto para converter arquivo em dataURL (evita estouro de argumentos com String.fromCharCode)
      const fileToDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

      // Política de foto: se há crop (dataURL), usa diretamente; senão redimensiona e comprime.
      if (fotoPreview && fotoPreview.startsWith('data:')) {
        payload.foto = fotoPreview;
      } else if (fotoFile) {
        try {
          payload.foto = await resizeImageToDataURL(fotoFile, 400, 0.85);
        } catch {
          try {
            payload.foto = await fileToDataUrl(fotoFile);
          } catch {
            notifyError('Não foi possível processar a foto. Tente outro arquivo.');
          }
        }
      }
      const qs = new URLSearchParams({ contaId: resolvedContaId }).toString();
      const res = await fetch(`/api/colaboradores?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro ao salvar' }));
        let errorMessage = data.error || 'Erro ao salvar';

        // Melhor tratamento para erros de validação
        if (/cpf:\s*/i.test(errorMessage)) {
          // Mensagem do Zod vem como "cpf: ..."
          errorMessage = 'CPF inválido. Verifique os números digitados.';
        } else if (/colaborador cadastrado com este cpf/i.test(errorMessage)) {
          // Mensagem amigável vinda do backend para duplicidade
          errorMessage = 'Já existe um colaborador cadastrado com este CPF';
        } else if (errorMessage.includes('telefone')) {
          errorMessage = 'Telefone inválido. Use o formato (00) 00000-0000.';
        } else if (errorMessage.includes('email')) {
          errorMessage = 'E-mail inválido. Verifique o formato digitado.';
        } else if (errorMessage.includes('enderecoCep') || errorMessage.includes('CEP')) {
          errorMessage = 'CEP inválido. Use o formato 12345-678.';
        }

        notifyError(errorMessage);
        return;
      }
      const response = await res.json().catch(() => null);
      const photoWarning = typeof response?.photoUploadWarning === 'string' ? response.photoUploadWarning : null;
      try {
        window.dispatchEvent(
          new CustomEvent('toast:success', {
            detail: { message: photoWarning ?? 'Colaborador cadastrado com sucesso' },
          }),
        );
      } catch {
        /* noop */
      }
      try {
        window.dispatchEvent(new CustomEvent('colaboradores:changed'));
        // Se for professor, dispara evento de professores para recarregar no wizard de Turmas
        if (payload.cargo === 'PROFESSOR') {
          window.dispatchEvent(new CustomEvent('professores:changed'));
        }
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

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        fullScreenMobile
        closeDisabled={submitting}
        overlayClass="alusa-registration-wizard-overlay"
        className={`colaborador-registration-wizard flex max-w-[1020px] w-full flex-col gap-0 overflow-hidden rounded-[20px] bg-white p-0 alusa-dark:bg-[color:var(--color-bg-card)] sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0 ${activeStep === 'confirmar' ? 'md:h-[min(640px,calc(100dvh-2rem))] md:min-h-0' : 'md:min-h-[492px]'}`}
        data-testid="colaborador-wizard"
      >
        <div inert={submitting || undefined} className="relative shrink-0 bg-white pb-5 pl-8 pr-10 pt-8 alusa-dark:bg-[color:var(--color-bg-card-soft)] max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="pr-2 text-xl font-normal tracking-tight text-[#0f0f0f] md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
                Cadastrar colaborador
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-sm text-[#5c5c5c] alusa-dark:text-[color:var(--color-text-secondary)]">
                Preencha os dados do colaborador em etapas.
              </DialogDescription>
            </div>
          </div>
          <div className="mt-3">
            <div className="h-[10px] w-full overflow-hidden rounded-full bg-[#eff3f8] alusa-dark:bg-[color:var(--color-border-default)]">
              <Progress
                value={((activeIndex + 1) / steps.length) * 100}
                className="h-[10px] bg-transparent [&>div]:bg-[#512a82]"
                aria-label="Progresso do cadastro do colaborador"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(((activeIndex + 1) / steps.length) * 100)}
              />
            </div>
            <div className="sr-only" aria-live="polite" data-testid="wizard-progress-text">
              Etapa {activeIndex + 1} de {steps.length}
            </div>
          </div>
        </div>
        <FormProvider {...methods}>
          <WizardErrorVisibilityProvider visible={errorsVisible}>
          <div inert={submitting || undefined} className="flex min-h-0 flex-1 flex-col overflow-x-clip max-md:max-h-none">
            <div className={`flex-1 overflow-x-clip bg-white pb-6 pl-8 pr-10 pt-3 alusa-dark:bg-[color:var(--color-bg-card-soft)] max-md:min-h-0 max-md:overflow-x-hidden max-md:overflow-y-auto max-md:p-4 ${activeStep === 'confirmar' ? 'md:min-h-0 md:overflow-x-hidden md:overflow-y-auto' : ''}`}>
              <div className="mx-auto w-full max-w-5xl">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="w-full space-y-6 overflow-x-hidden"
                  >
                    {activeStep === 'identificacao' && (
                      <SectionCard variant="open">
                        <StepHeader title="Identificação" />
                        <IdentificationFields />
                      </SectionCard>
                    )}
                    {activeStep === 'endereco' && (
                      <SectionCard variant="open">
                        <StepHeader title="Endereço" />
                        <AddressFields />
                      </SectionCard>
                    )}
                    {activeStep === 'vinculo' && (
                      <SectionCard variant="open">
                        <StepHeader
                          title="Vínculo"
                          hint="Informações de contratação e observações."
                        />
                        <EmploymentFields />
                      </SectionCard>
                    )}
                    {activeStep === 'foto' && (
                      <SectionCard variant="open">
                        <StepHeader
                          title="Foto do colaborador"
                          hint="Opcional — ajuda na rápida identificação em listas e acessos."
                        />
                        <PhotoFields
                          getRootProps={getRootProps}
                          getInputProps={getInputProps}
                          isDragActive={isDragActive}
                          fotoPreview={fotoPreview}
                          onRemove={() => setFotoFile(null)}
                          onOpenCrop={() => setCropOpen(true)}
                        />
                      </SectionCard>
                    )}
                    {activeStep === 'confirmar' && (
                      <SectionCard variant="open">
                        <div data-testid="wizard-confirmar">
                          <StepHeader
                            title="Confirmar dados"
                            hint="Revise as informações antes de concluir."
                          />
                          <ConfirmationSection />
                        </div>
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
                  data-testid="wizard-submit"
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
          className="colaborador-wizard-corner-smoothing"
          onDiscard={() => {
            setConfirmClose(false);
            onOpenChange(false);
          }}
        />
        {/* Dialog de Crop */}
        <ImageCropDialog
          className="colaborador-wizard-corner-smoothing"
          src={fotoPreview}
          open={cropOpen && !!fotoPreview}
          onOpenChange={(o) => setCropOpen(o)}
          onApply={(res) => {
            setFotoPreview(res.dataUrl);
            setCropOpen(false);
          }}
          aspect={1}
          title="Ajustar corte"
        />
        {submitting && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/15" aria-busy="true">
            <LoadingDots />
          </div>
        )}
        <style jsx global>{`
          .colaborador-registration-wizard .alusa-wizard-fields {
            --wizard-field-background: #f1f5f9;
            --wizard-field-hover-background: #e9eef5;
            --wizard-field-text: #0f172a;
          }

          .colaborador-registration-wizard .alusa-wizard-fields input.wizard-field-input,
          .colaborador-registration-wizard .alusa-wizard-fields textarea.wizard-field-input {
            background-color: var(--wizard-field-background) !important;
            border-color: transparent !important;
            box-shadow: none !important;
            transition: background-color 140ms ease-out;
          }

          .colaborador-registration-wizard .alusa-wizard-fields input.wizard-field-input:focus,
          .colaborador-registration-wizard .alusa-wizard-fields input.wizard-field-input:focus-visible,
          .colaborador-registration-wizard .alusa-wizard-fields textarea.wizard-field-input:focus,
          .colaborador-registration-wizard .alusa-wizard-fields textarea.wizard-field-input:focus-visible {
            background-color: transparent !important;
            border-color: #9ca3af !important;
            box-shadow: none !important;
            outline: none !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger {
            background-color: var(--wizard-field-background) !important;
            border: 0 !important;
            color: var(--wizard-field-text);
            transition: background-color 140ms ease-out;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger:focus,
          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger:focus-visible,
          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger[data-state='open'] {
            background-color: transparent !important;
            border: 1px solid #9ca3af !important;
            box-shadow: none !important;
            outline: none !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--required-empty,
          .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--error {
            box-shadow: none !important;
            padding-right: 48px !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--required-empty {
            background-color: #fff7ed !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--error {
            background-color: #fef2f2 !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger.wizard-field-input--required-empty,
          .colaborador-registration-wizard .alusa-wizard-fields .alusa-select-trigger.wizard-field-input--error {
            padding-right: 48px !important;
          }

          .colaborador-registration-wizard .alusa-wizard-fields .wizard-date-field:has(.wizard-field-input--required-empty) > div:last-child,
          .colaborador-registration-wizard .alusa-wizard-fields .wizard-date-field:has(.wizard-field-input--error) > div:last-child {
            right: 3rem;
          }

          [data-theme='dark'] .colaborador-registration-wizard .alusa-wizard-fields {
            --wizard-field-background: var(--color-bg-elevated);
            --wizard-field-hover-background: color-mix(in srgb, var(--color-bg-elevated) 93%, white);
            --wizard-field-text: var(--color-input-text);
          }

          [data-theme='dark'] .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--required-empty {
            background-color: rgb(245 158 11 / 10%) !important;
          }

          [data-theme='dark'] .colaborador-registration-wizard .alusa-wizard-fields .wizard-field-input--error {
            background-color: rgb(239 68 68 / 10%) !important;
          }

          @supports (corner-shape: superellipse(1.1)) {
            .colaborador-registration-wizard,
            .colaborador-registration-wizard :not(.rounded-full),
            .colaborador-wizard-corner-smoothing,
            .colaborador-wizard-corner-smoothing :not(.rounded-full) {
              corner-shape: superellipse(1.1);
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
