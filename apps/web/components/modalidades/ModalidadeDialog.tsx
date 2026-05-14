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
import type {
  ModalidadeListItem,
  ModalidadeStatus,
} from '@/features/cadastro/modalidades/services/modalidades-service';

export interface ModalidadeFormValues {
  nome: string;
  status: ModalidadeStatus;
  descricao: string;
}

type FieldKey = keyof ModalidadeFormValues;

interface Props {
  open: boolean;
  creating: boolean;
  modalidade: ModalidadeListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_values: ModalidadeFormValues) => Promise<void>;
}

const inputClass =
  'h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10';
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

const createDefaults: ModalidadeFormValues = { nome: '', status: 'ATIVO', descricao: '' };

export default function ModalidadeDialog({
  open,
  creating,
  modalidade,
  onOpenChange,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<ModalidadeFormValues>(createDefaults);
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
        className="w-full max-w-xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0"
      >
        <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-5 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 max-w-2xl text-sm text-slate-600">
            {description}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto scroll-smooth px-4 py-6 max-md:min-h-0 md:px-6">
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
                  onChange={(e) => handleFieldChange('nome', e.target.value)}
                  placeholder="Ex.: Ballet clássico"
                  autoComplete="off"
                  className={cn(
                    inputClass,
                    errors.nome &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.nome && <p className={errorClass}>{errors.nome}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="modalidade-status">
                  Status
                </label>
                <Select
                  value={values.status}
                  onValueChange={(v) => handleFieldChange('status', v as ModalidadeStatus)}
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
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Descrição</h3>
              <p className={helperClass}>Detalhe diferenciais e conteúdos abordados.</p>
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
                className={textareaClass}
              />
            </div>
          </section>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disable}
            onClick={() => onOpenChange(false)}
            className="h-11 min-h-11 w-full border-slate-200 text-slate-600 hover:bg-slate-100 md:h-10 md:min-h-0 md:min-w-[120px] md:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={disable}
            onClick={() => {
              void handleSubmit();
            }}
            className="h-11 min-h-11 w-full bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:min-w-[136px] md:w-auto"
          >
            {submitting ? (creating ? 'Criando...' : 'Salvando...') : creating ? 'Criar' : 'Salvar'}
          </Button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
