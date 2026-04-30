import { useEffect, useMemo, useState } from 'react';
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
import type { SalaListItem, SalaStatus } from '@/features/cadastro/salas/services/salas-service';

export interface SalaFormValues {
  nome: string;
  status: SalaStatus;
  capacidade: string; // manter como string no form
  descricao: string;
}

type FieldKey = keyof SalaFormValues;

interface Props {
  open: boolean;
  creating: boolean;
  sala: SalaListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_values: SalaFormValues) => Promise<void>;
}

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const selectTriggerClass = cn(
  inputClass,
  'flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400',
);
const textareaClass =
  'min-h-[120px] w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const sectionClass = 'space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5';
const labelClass = 'text-xs font-medium text-slate-600';
const helperClass = 'text-xs text-slate-500';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

const defaults: SalaFormValues = { nome: '', status: 'ATIVO', capacidade: '', descricao: '' };

export default function SalaDialog({ open, creating, sala, onOpenChange, onSubmit }: Props) {
  const [values, setValues] = useState<SalaFormValues>(defaults);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const statusOptions = useMemo(
    () => [
      { value: 'ATIVO' as SalaStatus, label: 'Ativa' },
      { value: 'INATIVO' as SalaStatus, label: 'Inativa' },
    ],
    [],
  );

  useEffect(() => {
    if (open) {
      if (creating) {
        setValues(defaults);
      } else if (sala) {
        setValues({
          nome: sala.nome ?? '',
          status: sala.status,
          capacidade: sala.capacidade ? String(sala.capacidade) : '',
          descricao: sala.descricao ?? '',
        });
      }
      setErrors({});
    } else {
      setValues(defaults);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, creating, sala]);

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
    if (!values.nome.trim()) next.nome = 'Informe o nome da sala.';
    const cap = Number(values.capacidade);
    if (!values.capacidade.trim() || Number.isNaN(cap) || cap <= 0)
      next.capacidade = 'Informe uma capacidade válida (maior que zero).';
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
  const title = creating ? 'Nova sala' : 'Editar sala';
  const description = creating
    ? 'Cadastre uma nova sala para organizar as turmas.'
    : 'Atualize os dados da sala.';

  return (
    <Dialog open={open} onOpenChange={(next) => !disable && onOpenChange(next)}>
      <DialogContent className="w-full max-w-xl overflow-hidden p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-600">
            {description}
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-6 px-6 py-6 max-h-[70vh] overflow-y-auto">
          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Informações gerais</h3>
              <p className={helperClass}>Nome, status e capacidade.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className={labelClass} htmlFor="sala-nome">
                  Nome da sala
                </label>
                <Input
                  id="sala-nome"
                  value={values.nome}
                  onChange={(e) => handleFieldChange('nome', e.target.value)}
                  placeholder="Ex.: Sala Studio 1"
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
                <label className={labelClass} htmlFor="sala-status">
                  Status
                </label>
                <Select
                  value={values.status}
                  onValueChange={(v) => handleFieldChange('status', v as SalaStatus)}
                >
                  <SelectTrigger id="sala-status" className={selectTriggerClass}>
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
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="sala-capacidade">
                  Capacidade (pessoas)
                </label>
                <Input
                  id="sala-capacidade"
                  type="number"
                  min={1}
                  value={values.capacidade}
                  onChange={(e) => handleFieldChange('capacidade', e.target.value)}
                  className={cn(
                    inputClass,
                    errors.capacidade &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.capacidade && <p className={errorClass}>{errors.capacidade}</p>}
              </div>
            </div>
          </section>
          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Descrição</h3>
              <p className={helperClass}>Detalhes sobre estrutura e equipamentos.</p>
            </header>
            <div className="flex flex-col gap-1">
              <label className={labelClass} htmlFor="sala-descricao">
                Descrição
              </label>
              <Textarea
                id="sala-descricao"
                value={values.descricao}
                onChange={(e) => handleFieldChange('descricao', e.target.value)}
                placeholder="Ex.: Sala com espelhos, barras fixas e piso vinílico."
                className={textareaClass}
              />
            </div>
          </section>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={disable}
            onClick={() => onOpenChange(false)}
            className="min-w-[120px] border-slate-200 text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={disable}
            onClick={() => {
              void handleSubmit();
            }}
            className="min-w-[136px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
          >
            {submitting ? (creating ? 'Criando...' : 'Salvando...') : creating ? 'Criar' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
