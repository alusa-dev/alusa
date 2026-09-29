import { useEffect, useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  wizardFieldInputClass,
  wizardTextareaFieldClass,
} from '@/components/shared/wizard/field-styles';
import type {
  ModalityListItem,
  ModalityStatus,
} from '@/features/modalities/services/modalities-service';

export interface ModalityFormValues {
  nome: string;
  status: ModalityStatus;
  descricao: string;
}

type FieldKey = keyof ModalityFormValues;

interface Props {
  open: boolean;
  creating: boolean;
  modalidade: ModalityListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_values: ModalityFormValues) => Promise<void>;
}

const inputClass = wizardFieldInputClass;
const selectTriggerClass = cn(
  inputClass,
  'alusa-select-trigger flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400',
);
const sectionClass =
  'alusa-session-panel space-y-3 rounded-xl border border-slate-200 bg-white p-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]';
const labelClass =
  'block text-xs font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

const createDefaults: ModalityFormValues = { nome: '', status: 'ATIVO', descricao: '' };

export default function ModalityDialog({
  open,
  creating,
  modalidade,
  onOpenChange,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<ModalityFormValues>(createDefaults);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const statusOptions = useMemo(
    () => [
      { value: 'ATIVO' as ModalityStatus, label: 'Ativa' },
      { value: 'INATIVO' as ModalityStatus, label: 'Inativa' },
    ],
    [],
  );

  useEffect(() => {
    if (open) {
      if (creating) {
        setValues(createDefaults);
      } else if (modalidade) {
        setValues({
          nome: modalidade.nome ?? '',
          status: modalidade.status,
          descricao: modalidade.descricao ?? '',
        });
      }
      setErrors({});
    } else {
      setValues(createDefaults);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, creating, modalidade]);

  function handleFieldChange(key: FieldKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!values.nome.trim()) next.nome = 'Informe o nome da modalidade.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!validate()) return;
    try {
      setSubmitting(true);
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  }

  const disable = submitting;
  const title = creating ? 'Nova modalidade' : 'Editar modalidade';
  const description = creating
    ? 'Cadastre uma nova modalidade para utilizar nas turmas e planos.'
    : 'Atualize os dados da modalidade para mantê-los consistentes.';

  return (
    <Dialog open={open} onOpenChange={(next) => !disable && onOpenChange(next)}>
      <DialogContent
        fullScreenMobile
        overlayClass="alusa-registration-wizard-overlay"
        className="modality-registration-dialog alusa-wizard-corner-smoothing flex w-full max-w-xl min-h-0 flex-col gap-0 overflow-hidden rounded-2xl bg-[#f8fafc] p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:h-[100dvh] max-md:max-h-[100dvh] md:max-h-[90vh]"
      >
        <div className="relative shrink-0 bg-[#f8fafc] px-4 py-4 alusa-dark:bg-[color:var(--color-bg-card)] max-md:pb-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            {description}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="alusa-wizard-fields flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth bg-[#f8fafc] px-4 py-4 max-md:min-h-0 alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-5">
            <section className={sectionClass}>
              <header>
                <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                  Informações básicas
                </h3>
              </header>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className={labelClass} htmlFor="modalidade-nome">
                    Nome da modalidade
                  </label>
                  <Input
                    id="modalidade-nome"
                    value={values.nome}
                    onChange={(e) => handleFieldChange('nome', e.target.value)}
                    placeholder="Ex.: Ballet clássico"
                    autoComplete="off"
                    className={cn(inputClass, errors.nome && 'wizard-field-input--error')}
                  />
                  {errors.nome ? <p className={errorClass}>{errors.nome}</p> : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label className={labelClass} htmlFor="modalidade-status">
                    Status
                  </label>
                  <Select
                    value={values.status}
                    onValueChange={(v) => handleFieldChange('status', v as ModalityStatus)}
                  >
                    <SelectTrigger id="modalidade-status" className={selectTriggerClass}>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
            <section className={sectionClass}>
              <header>
                <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
                  Descrição
                </h3>
              </header>
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="modalidade-descricao">
                  Descrição
                </label>
                <Textarea
                  id="modalidade-descricao"
                  value={values.descricao}
                  onChange={(e) => handleFieldChange('descricao', e.target.value)}
                  placeholder="Ex.: Aula com foco na técnica clássica, alongamento e musicalidade."
                  className={wizardTextareaFieldClass}
                />
              </div>
            </section>
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-3 bg-[#f8fafc] p-4 alusa-dark:bg-[color:var(--color-bg-card)] md:flex-row md:items-center md:justify-end md:px-6 md:py-4">
            <Button
              type="button"
              variant="outline"
              disabled={disable}
              onClick={() => onOpenChange(false)}
              className="h-11 min-h-11 w-full rounded-[10px] border-slate-200 bg-white text-slate-700 shadow-none hover:bg-slate-50 md:h-10 md:min-h-0 md:min-w-[120px] md:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={disable}
              onClick={() => {
                void handleSubmit();
              }}
              className="h-11 min-h-11 w-full rounded-[10px] bg-[#512a82] text-white shadow-none hover:bg-[#45236f] md:h-10 md:min-h-0 md:min-w-[136px] md:w-auto"
            >
              {submitting
                ? creating
                  ? 'Criando...'
                  : 'Salvando...'
                : creating
                  ? 'Criar'
                  : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
