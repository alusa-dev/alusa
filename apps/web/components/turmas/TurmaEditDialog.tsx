import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import type {
  TurmaListItem,
  TurmaStatus,
} from '@/features/cadastro/turmas/services/turmas-service';

export type TurmaEditFormValues = {
  nome: string;
  status: TurmaStatus;
  capacidade: string;
  horaInicio: string;
  horaFim: string;
};

type FieldKey = keyof TurmaEditFormValues;

type Props = {
  open: boolean;
  turma: TurmaListItem | null;
  onOpenChange: (_open: boolean) => void;
  onSubmit: (_values: TurmaEditFormValues) => Promise<void>;
};

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const selectTriggerClass = cn(
  inputClass,
  'flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400',
);
const sectionClass = 'space-y-5 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5';
const labelClass = 'text-xs font-medium text-slate-600';
const helperClass = 'text-xs text-slate-500';
const errorClass = 'text-[11px] font-medium text-[#DC2626]';

function normalizeTime(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value.slice(0, 5);
  return value;
}

function minutesFrom(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

const defaultValues: TurmaEditFormValues = {
  nome: '',
  status: 'ATIVO',
  capacidade: '',
  horaInicio: '',
  horaFim: '',
};

export default function TurmaEditDialog({ open, turma, onOpenChange, onSubmit }: Props) {
  const [values, setValues] = useState<TurmaEditFormValues>(defaultValues);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const statusOptions = useMemo(
    () => [
      { value: 'ATIVO' as TurmaStatus, label: 'Ativa' },
      { value: 'INATIVO' as TurmaStatus, label: 'Inativa' },
    ],
    [],
  );

  useEffect(() => {
    if (open && turma) {
      setValues({
        nome: turma.nome || '',
        status: turma.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
        capacidade: turma.capacidade != null ? String(turma.capacidade) : '',
        horaInicio: normalizeTime(turma.horaInicio),
        horaFim: normalizeTime(turma.horaFim),
      });
      setErrors({});
    }
    if (!open) {
      setValues(defaultValues);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, turma]);

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
    if (!values.nome.trim()) nextErrors.nome = 'Informe o nome da turma.';

    const capacidadeNumber = Number(values.capacidade);
    if (!values.capacidade.trim() || Number.isNaN(capacidadeNumber) || capacidadeNumber <= 0) {
      nextErrors.capacidade = 'Informe uma capacidade válida (maior que zero).';
    }

    if (!values.horaInicio.trim()) nextErrors.horaInicio = 'Informe a hora de início.';
    if (!values.horaFim.trim()) nextErrors.horaFim = 'Informe a hora de término.';

    const startMinutes = minutesFrom(values.horaInicio.trim());
    const endMinutes = minutesFrom(values.horaFim.trim());
    if (startMinutes != null && endMinutes != null && endMinutes <= startMinutes) {
      nextErrors.horaFim = 'Hora final deve ser posterior à hora inicial.';
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
      <DialogContent className="w-full max-w-3xl overflow-hidden p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">Editar turma</DialogTitle>
          <p className="mt-1 text-sm text-slate-600">
            Atualize os dados cadastrais e de horário da turma para manter a grade organizada.
          </p>
        </div>
        <div className="flex flex-col gap-6 px-6 py-6">
          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Informações gerais</h3>
              <p className={helperClass}>Nome, status e capacidade da turma.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className={labelClass} htmlFor="turma-nome">
                  Nome da turma
                </label>
                <Input
                  id="turma-nome"
                  value={values.nome}
                  onChange={(event) => handleFieldChange('nome', event.target.value)}
                  placeholder="Ex.: Ballet 1 - Matutino"
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
                <label className={labelClass} htmlFor="turma-status">
                  Status
                </label>
                <Select
                  value={values.status}
                  onValueChange={(value) => handleFieldChange('status', value as TurmaStatus)}
                >
                  <SelectTrigger id="turma-status" className={cn(selectTriggerClass)}>
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
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="turma-capacidade">
                  Capacidade (alunos)
                </label>
                <Input
                  id="turma-capacidade"
                  type="number"
                  min={1}
                  value={values.capacidade}
                  onChange={(event) => handleFieldChange('capacidade', event.target.value)}
                  className={cn(
                    inputClass,
                    errors.capacidade &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.capacidade ? <p className={errorClass}>{errors.capacidade}</p> : null}
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-slate-800">Horário</h3>
              <p className={helperClass}>Atualize os horários para evitar conflitos na agenda.</p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="turma-hora-inicio">
                  Hora de início
                </label>
                <Input
                  id="turma-hora-inicio"
                  type="time"
                  value={values.horaInicio}
                  onChange={(event) => handleFieldChange('horaInicio', event.target.value)}
                  className={cn(
                    inputClass,
                    errors.horaInicio &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.horaInicio ? <p className={errorClass}>{errors.horaInicio}</p> : null}
              </div>
              <div className="flex flex-col gap-1">
                <label className={labelClass} htmlFor="turma-hora-fim">
                  Hora de término
                </label>
                <Input
                  id="turma-hora-fim"
                  type="time"
                  value={values.horaFim}
                  onChange={(event) => handleFieldChange('horaFim', event.target.value)}
                  className={cn(
                    inputClass,
                    errors.horaFim &&
                      'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20',
                  )}
                />
                {errors.horaFim ? <p className={errorClass}>{errors.horaFim}</p> : null}
              </div>
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
