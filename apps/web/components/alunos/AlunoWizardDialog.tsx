'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useForm, FormProvider } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImageCropDialog } from '../image/ImageCropDialog';
import { alunoSchema, type AlunoInput } from '../../../../prisma/zod/aluno';
import { StepHeader, SectionCard } from './wizard/ui';
import IdentificacaoFields from './wizard/steps/IdentificacaoFields';
import EnderecoFields from './wizard/steps/EnderecoFields';
import SaudeFields from './wizard/steps/SaudeFields';
import PerfilFields from './wizard/steps/PerfilFields';
import FotoFields from './wizard/steps/FotoFields';
import ResponsavelFields from './wizard/steps/ResponsavelFields';
import ConfirmacaoSection from './wizard/steps/ConfirmacaoSection';
import {
  digits,
  parseMaybeDate,
  yearsDiff,
  buildStepFieldMap,
  focusFirstError,
} from './wizard/utils';

type StepId =
  | 'identificacao'
  | 'endereco'
  | 'saude'
  | 'perfil'
  | 'foto'
  | 'responsavel'
  | 'confirmar';
type WizardData = AlunoInput;

export interface AlunoWizardDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onFinish?: () => void;
  contaId?: string | null;
}

export default function AlunoWizardDialog({
  open,
  onOpenChange,
  onFinish,
  contaId,
}: AlunoWizardDialogProps) {
  // --- VISUAL STATE (não afeta lógica de formulário) ---
  const [headerElevated, setHeaderElevated] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const resolvedContaId = React.useMemo(() => {
    if (typeof contaId === 'string' && contaId.trim().length > 0) return contaId;
    return null;
  }, [contaId]);

  const methods = useForm<WizardData>({
    resolver: zodResolver(alunoSchema),
    defaultValues: {
      status: 'ATIVO',
      responsavel: null,
      responsavelModo: 'existente',
      responsavelExistenteId: null,
    } as Partial<WizardData>,
    mode: 'onBlur',
  });

  const [confirmClose, setConfirmClose] = React.useState(false);
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
    if (!open) return;
    methods.reset({
      contaId: resolvedContaId ?? undefined,
      status: 'ATIVO',
      responsavelModo: 'existente',
      responsavelExistenteId: null,
      responsavel: null,
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
    if (next === false && open) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  }
  React.useEffect(() => {
    if (!confirmClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConfirmClose(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmClose]);

  const stepFields = React.useMemo(() => buildStepFieldMap(isMinor), [isMinor]);
  function canGoPrev() {
    return activeIndex > 0;
  }
  function goPrev() {
    if (canGoPrev()) setActiveIndex((i) => i - 1);
  }
  async function goNext() {
    const fields = stepFields[activeStep] as unknown as (keyof WizardData)[];
    if (fields.length) {
      const ok = await methods.trigger(fields);
      if (!ok) {
        focusFirstError(methods.formState.errors);
        return;
      }
    }
    setActiveIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function submitAll() {
    if (!resolvedContaId) {
      notifyError('Não foi possível identificar a conta do cadastro.');
      return;
    }
    const ok = await methods.trigger();
    if (!ok) {
      const errors = methods.formState.errors;
      console.error('[AlunoWizard] Erros de validação:', errors);

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
        title="Cadastrar aluno"
        className="max-w-5xl w-full overflow-hidden p-0 bg-slate-50"
        data-testid="aluno-wizard"
      >
        <div
          className={
            'relative border-b border-slate-200 bg-slate-50 p-4 md:p-6 transition-shadow duration-200 ' +
            (headerElevated ? 'shadow-sm' : '')
          }
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="text-xl font-semibold text-slate-900 tracking-tight">
            Cadastrar aluno
          </DialogTitle>
          <p className="mt-1 text-sm text-slate-600 max-w-2xl">
            Preencha os dados do aluno em etapas.
          </p>
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
              <Progress
                value={((activeIndex + 1) / steps.length) * 100}
                className="h-2 bg-transparent [&>div]:bg-gradient-to-r [&>div]:from-brand-accent [&>div]:to-brand-accent/70"
                aria-label="Progresso do cadastro do aluno"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(((activeIndex + 1) / steps.length) * 100)}
              />
            </div>
            <div
              className="mt-2 text-xs font-medium text-slate-600"
              aria-live="polite"
              data-testid="wizard-progress-text"
            >
              Etapa {activeIndex + 1} de {steps.length}
            </div>
          </div>
        </div>
        <FormProvider {...methods}>
          <div className="flex max-h-[78vh] flex-col overflow-x-hidden">
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const sc = e.currentTarget.scrollTop;
                if (sc > 4 && !headerElevated) setHeaderElevated(true);
                else if (sc <= 4 && headerElevated) setHeaderElevated(false);
              }}
              className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 bg-slate-50 scroll-smooth"
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
                    {activeStep === 'identificacao' && (
                      <SectionCard>
                        <StepHeader title="Identificação" />
                        <IdentificacaoFields />
                      </SectionCard>
                    )}
                    {activeStep === 'endereco' && (
                      <SectionCard>
                        <StepHeader title="Endereço" />
                        <EnderecoFields />
                      </SectionCard>
                    )}
                    {activeStep === 'saude' && (
                      <SectionCard>
                        <StepHeader title="Saúde & Emergência" />
                        <SaudeFields />
                      </SectionCard>
                    )}
                    {activeStep === 'perfil' && (
                      <SectionCard>
                        <StepHeader
                          title="Perfil & Classificação"
                          hint="Campos de categorização interna e consentimentos."
                        />
                        <PerfilFields />
                      </SectionCard>
                    )}
                    {activeStep === 'foto' && (
                      <SectionCard>
                        <StepHeader
                          title="Foto do aluno"
                          hint="Facilita identificação em listas e matrículas (Opcional)."
                        />
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileInputChange}
                        />
                        <FotoFields
                          fotoPreview={foto ? foto : null}
                          avatarFallback={avatarFallback}
                          onEdit={handleEditPhoto}
                          onReplace={handlePickPhoto}
                          onRemove={handleRemovePhoto}
                        />
                      </SectionCard>
                    )}
                    {activeStep === 'responsavel' && isMinor && (
                      <SectionCard>
                        <StepHeader
                          title="Responsável"
                          hint="Obrigatório para menores de 18 anos."
                        />
                        <ResponsavelFields />
                      </SectionCard>
                    )}
                    {activeStep === 'confirmar' && (
                      <SectionCard>
                        <StepHeader
                          title="Confirmar dados"
                          hint="Revise cuidadosamente antes de concluir."
                        />
                        <ConfirmacaoSection all={methods.getValues()} fotoPreview={foto || null} />
                      </SectionCard>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-4 md:p-6 flex items-center justify-end gap-3 sticky bottom-0">
              <Button
                type="button"
                variant="outline"
                onClick={goPrev}
                disabled={!canGoPrev() || submitting}
                className="h-10 px-4 min-w-[140px] border-slate-200 text-slate-600 bg-white hover:bg-slate-100 shadow-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-none"
                data-testid="wizard-prev"
              >
                Etapa Anterior
              </Button>
              {activeStep !== 'confirmar' ? (
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={submitting}
                  className="h-10 px-5 min-w-[160px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-accent/60 disabled:opacity-60 disabled:pointer-events-none"
                  data-testid="wizard-next"
                >
                  Próxima Etapa
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submitAll}
                  disabled={submitting}
                  className="h-10 px-5 min-w-[160px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-accent/60 disabled:opacity-60 disabled:pointer-events-none"
                  data-testid="aluno-concluir"
                >
                  {submitting ? 'Salvando...' : 'Concluir'}
                </Button>
              )}
            </div>
          </div>
        </FormProvider>
        {confirmClose && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/65 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95">
              <h4 className="text-sm font-semibold text-slate-800">Descartar cadastro?</h4>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Existem informações não salvas. Se você sair agora, todos os dados digitados serão
                perdidos.
              </p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  className="border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-accent/40"
                  onClick={() => setConfirmClose(false)}
                >
                  Continuar preenchendo
                </Button>
                <Button
                  type="button"
                  className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500/60"
                  onClick={() => {
                    setConfirmClose(false);
                    onOpenChange(false);
                  }}
                >
                  Descartar
                </Button>
              </div>
            </div>
          </div>
        )}
        <ImageCropDialog
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
      </DialogContent>
    </Dialog>
  );
}
