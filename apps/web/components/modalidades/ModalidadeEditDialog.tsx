import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import type {
  ModalidadeListItem,
  ModalidadeStatus,
} from '@/features/cadastro/modalidades/services/modalidades-service';

export type ModalidadeEditFormValues = {
  nome: string;
  status: ModalidadeStatus;
  descricao: string;
};

type FieldKey = keyof ModalidadeEditFormValues;

type Props = {
  open: boolean;
  modalidade: ModalidadeListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_values: ModalidadeEditFormValues) => Promise<void>;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const selectTriggerClass = cn(
  inputClass,
  'flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400',
);
const textareaClass =
  'min-h-[140px] w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const sectionClass = 'space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5';
const labelClass = 'text-xs font-medium text-slate-600';
const helperClass = 'text-xs text-slate-500';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

const defaultValues: ModalidadeEditFormValues = {
  nome: '',
  status: 'ATIVO',
  descricao: '',
};

export default function ModalidadeEditDialog({ open, modalidade, onOpenChange, onSubmit }: Props) {
  const [values, setValues] = useState<ModalidadeEditFormValues>(defaultValues);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const statusOptions = useMemo(
    () => [
      { value: 'ATIVO' as ModalidadeStatus, label: 'Ativa' },
      { value: 'INATIVO' as ModalidadeStatus, label: 'Inativa' },
    ],
    [],
  );

  useEffect(() => {
    if (open && modalidade) {
      setValues({
        nome: modalidade.nome ?? '',
        status: modalidade.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        descricao: modalidade.descricao ?? '',
      });
      setErrors({});
    }
    if (!open) {
      setValues(defaultValues);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, modalidade]);

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
    const nextErrors: Partial<Record<FieldKey, string>> = {};

    if (!values.nome.trim()) {
      nextErrors.nome = 'Informe o nome da modalidade.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
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

  const disableActions = submitting;

  return (
    <Dialog open={open} onOpenChange={(next) => !disableActions && onOpenChange(next)}>
      <DialogContent className="w-full max-w-2xl overflow-hidden p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">
            Editar modalidade
          </DialogTitle>
          <p className="mt-1 text-sm text-slate-600">
            Deixe os dados da modalidade sempre atualizados para facilitar a gestão e a venda de
            planos.
          </p>
        </div>
        <div className="flex flex-col gap-6 px-6 py-6">
          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Informações básicas</h3>
              <p className={helperClass}>Nome e status da modalidade.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className={labelClass} htmlFor="modalidade-nome">
                  Nome da modalidade
                </label>
                <Input
                  id="modalidade-nome"
                  value={values.nome}
                  onChange={(event) => handleFieldChange('nome', event.target.value)}
                  placeholder="Ex.: Ballet clássico"
                  autoComplete="off"
                  className={cn(
                    inputClass,
                    errors.nome &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.nome ? <p className={errorClass}>{errors.nome}</p> : null}
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="modalidade-status">
                  Status
                </label>
                <Select
                  value={values.status}
                  onValueChange={(value) => handleFieldChange('status', value as ModalidadeStatus)}
                >
                  <SelectTrigger id="modalidade-status" className={selectTriggerClass}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Descrição</h3>
              <p className={helperClass}>
                Destaque benefícios, conteúdos abordados e diferenciais da modalidade.
              </p>
            </header>
            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="modalidade-descricao">
                Descrição
              </label>
              <Textarea
                id="modalidade-descricao"
                value={values.descricao}
                onChange={(event) => handleFieldChange('descricao', event.target.value)}
                placeholder="Ex.: Aula com foco na técnica clássica, alongamento e musicalidade."
                className={textareaClass}
              />
            </div>
          </section>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disableActions}
            onClick={() => onOpenChange(false)}
            className="min-w-[120px] border-slate-200 text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={disableActions}
            onClick={() => {
              void handleSubmit();
            }}
            className="min-w-[136px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
          >
            {submitting ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
