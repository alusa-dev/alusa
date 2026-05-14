/* eslint-disable */
'use client';
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useSession } from 'next-auth/react';

import {
  StepHeader,
  SectionCard,
  IdentificacaoFields,
  EnderecoFields,
  VinculoFields,
  ConfirmacaoSection,
  buildStepFieldMap,
  digits,
  focusFirstError,
} from './wizard';
import { isValidCPF, isValidTelefone, isValidCEP } from './wizard/validators';
import FotoFields from './wizard/steps/FotoFields';
import { useDropzone } from 'react-dropzone';
import { ImageCropDialog } from '../image/ImageCropDialog';
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
} from '../../../../packages/lib/src/schemas/colaborador';

type StepId = 'identificacao' | 'endereco' | 'vinculo' | 'foto' | 'confirmar';

export interface ColaboradorWizardDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onFinish?: () => void;
  contaId?: string;
}

export default function ColaboradorWizardDialog({
  open,
  onOpenChange,
  onFinish,
  contaId,
}: ColaboradorWizardDialogProps) {
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
    if (canGoPrev()) setActiveIndex((i) => i - 1);
  }
  async function goNext() {
    const id = activeStep;
    const fields = stepFields[id] as unknown as (keyof ColaboradorInput)[];
    if (fields.length > 0) {
      const ok = await methods.trigger(fields);
      if (!ok) {
        focusFirstError(methods.formState.errors);
        return;
      }
    }
    setActiveIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function submitAll() {
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
      try {
        window.dispatchEvent(
          new CustomEvent('toast:success', {
            detail: { message: 'Colaborador cadastrado com sucesso' },
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
        className="max-w-5xl w-full gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0"
        data-testid="colaborador-wizard"
      >
        <div className="relative border-b border-slate-200 bg-slate-50 p-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:p-6">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
            Cadastrar colaborador
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-2xl text-sm text-slate-600">
            Preencha os dados do colaborador em etapas.
          </DialogDescription>
          <div className="mt-4 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/50">
              <Progress
                value={((activeIndex + 1) / steps.length) * 100}
                className="h-2 bg-transparent [&>div]:bg-gradient-to-r [&>div]:from-brand-accent [&>div]:to-brand-accent/70"
                aria-label="Progresso do cadastro"
              />
            </div>
            <div className="text-xs font-medium text-slate-600" aria-live="polite">
              Etapa {activeIndex + 1} de {steps.length}
            </div>
          </div>
        </div>
        <FormProvider {...methods}>
          <div className="flex max-h-[78vh] min-h-0 flex-col overflow-x-hidden max-md:max-h-none max-md:flex-1">
            <div className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth bg-slate-50 p-4 max-md:min-h-0 md:p-6">
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
                    {activeStep === 'vinculo' && (
                      <SectionCard>
                        <StepHeader
                          title="Vínculo"
                          hint="Informações de contratação e observações."
                        />
                        <VinculoFields />
                      </SectionCard>
                    )}
                    {activeStep === 'foto' && (
                      <SectionCard>
                        <StepHeader
                          title="Foto do colaborador"
                          hint="Opcional — ajuda na rápida identificação em listas e acessos."
                        />
                        <FotoFields
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
                      <SectionCard>
                        <div data-testid="wizard-confirmar">
                          <StepHeader
                            title="Confirmar dados"
                            hint="Revise cuidadosamente antes de concluir."
                          />
                          <ConfirmacaoSection />
                        </div>
                      </SectionCard>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            <div className="sticky bottom-0 flex shrink-0 flex-col-reverse items-stretch gap-3 border-t border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-end md:gap-3 md:p-6">
              <Button
                type="button"
                variant="outline"
                onClick={goPrev}
                disabled={!canGoPrev() || submitting}
                className="h-11 min-h-11 min-w-0 border-slate-200 bg-white px-4 text-slate-600 shadow-none hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 md:h-10 md:min-h-0 md:min-w-[140px]"
                data-testid="wizard-prev"
              >
                Etapa Anterior
              </Button>
              {activeStep !== 'confirmar' ? (
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={submitting}
                  className="h-11 min-h-11 min-w-0 bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90 focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 md:h-10 md:min-h-0 md:min-w-[160px]"
                  data-testid="wizard-next"
                >
                  Próxima Etapa
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submitAll}
                  disabled={submitting}
                  className="h-11 min-h-11 min-w-0 bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90 focus-visible:ring-2 focus-visible:ring-brand-accent/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 md:h-10 md:min-h-0 md:min-w-[160px]"
                  data-testid="wizard-submit"
                >
                  {submitting ? 'Salvando...' : 'Concluir'}
                </Button>
              )}
            </div>
          </div>
        </FormProvider>

        {confirmClose && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/65 p-4 backdrop-blur-sm max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))] max-md:pt-[calc(1rem+env(safe-area-inset-top,0px))]">
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
        {/* Dialog de Crop */}
        <ImageCropDialog
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
      </DialogContent>
    </Dialog>
  );
}
