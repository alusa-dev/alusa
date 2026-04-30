'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  AulasLookupItemDTO,
  CalendarEventDetailsDTO,
  CalendarEventStatusDTO,
  CalendarEventTypeDTO,
} from '@/features/aulas/dtos';
import { createAgendaEvent, updateAgendaEvent } from '@/features/aulas/agenda/services/agenda-service';
import { CALENDAR_EVENT_STATUS_OPTIONS, CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/aulas/types';
import { cn } from '@/lib/utils';

type CalendarEventDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  resources: {
    turmas: AulasLookupItemDTO[];
    professores: AulasLookupItemDTO[];
    salas: AulasLookupItemDTO[];
  };
  initialEvent?: CalendarEventDetailsDTO | null;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
};

type EventFormState = {
  title: string;
  description: string;
  type: CalendarEventTypeDTO;
  status: CalendarEventStatusDTO;
  startAt: string;
  endAt: string;
  turmaId: string;
  salaId: string;
  professorId: string;
};

const EMPTY_VALUE = '__NONE__';
const CONTROL_CLASS = 'h-10 rounded-xl border-slate-200 bg-white text-[13px]';

function toLocalInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocalDateTime(value: string) {
  if (!value) {
    return { date: undefined as Date | undefined, time: '' };
  }

  const [datePart, timePart = ''] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);

  if (!year || !month || !day) {
    return { date: undefined as Date | undefined, time: '' };
  }

  return {
    date: new Date(year, month - 1, day),
    time: timePart.slice(0, 5),
  };
}

function buildLocalDateTime(date?: Date, time = '') {
  if (!date) return '';

  const hours = time.slice(0, 2) || '00';
  const minutes = time.slice(3, 5) || '00';
  const pad = (input: number) => String(input).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hours}:${minutes}`;
}

function getDefaultStartAt() {
  return buildLocalDateTime(new Date(), '00:00');
}

function FieldLabel({ children }: { children: string }) {
  return <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{children}</label>;
}

function SectionBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function CalendarEventDialog({
  open,
  mode,
  resources,
  initialEvent,
  onOpenChange,
  onSaved,
}: CalendarEventDialogProps) {
  const [values, setValues] = useState<EventFormState>({
    title: '',
    description: '',
    type: 'AULA',
    status: 'AGENDADO',
    startAt: getDefaultStartAt(),
    endAt: '',
    turmaId: '',
    salaId: '',
    professorId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValues({
        title: '',
        description: '',
        type: 'AULA',
        status: 'AGENDADO',
        startAt: getDefaultStartAt(),
        endAt: '',
        turmaId: '',
        salaId: '',
        professorId: '',
      });
      setSubmitting(false);
      setError(null);
      return;
    }

    if (!initialEvent) return;

    setValues({
      title: initialEvent.title,
      description: initialEvent.description ?? '',
      type: initialEvent.type,
      status: initialEvent.status,
      startAt: toLocalInputValue(initialEvent.startAt),
      endAt: toLocalInputValue(initialEvent.endAt),
      turmaId: initialEvent.turma?.id ?? '',
      salaId: initialEvent.sala?.id ?? '',
      professorId: initialEvent.professores[0]?.id ?? '',
    });
  }, [initialEvent, open]);

  async function handleSubmit() {
    try {
      setSubmitting(true);
      setError(null);

      if (!values.startAt || Number.isNaN(new Date(values.startAt).getTime())) {
        throw new Error('Informe uma data e hora de início válidas.');
      }

      if (!values.endAt || Number.isNaN(new Date(values.endAt).getTime())) {
        throw new Error('Informe uma data e hora de fim válidas.');
      }

      const payload = {
        title: values.title.trim(),
        description: values.description.trim() || null,
        type: values.type,
        status: mode === 'edit' ? values.status : undefined,
        startAt: new Date(values.startAt).toISOString(),
        endAt: new Date(values.endAt).toISOString(),
        turmaId: values.turmaId || null,
        salaId: values.salaId || null,
        professorIds: values.professorId ? [values.professorId] : [],
      };

      if (mode === 'edit' && initialEvent) {
        await updateAgendaEvent(initialEvent.id, payload);
      } else {
        await createAgendaEvent(payload);
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl gap-0 overflow-hidden rounded-3xl p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="flex h-full max-h-[85vh] flex-col bg-white"
        >
          <DialogHeader className="border-b border-slate-100 px-6 py-5">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {mode === 'edit' ? 'Editar evento' : 'Novo evento'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Cadastre o essencial e mantenha a agenda operacional organizada no mesmo padrão do sistema.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[76vh] overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              <SectionBlock
                title="Informações do evento"
                description="Defina o que será agendado, quando acontece e qual contexto acadêmico deve ser vinculado."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel>Título</FieldLabel>
                    <Input
                      value={values.title}
                      onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
                      className={CONTROL_CLASS}
                      placeholder="Ex.: Ballet • Turma Intermediária"
                      data-testid="agenda-event-title"
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>Tipo</FieldLabel>
                    <Select
                      value={values.type}
                      onValueChange={(value: CalendarEventTypeDTO) =>
                        setValues((current) => ({ ...current, type: value }))
                      }
                    >
                      <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-type">
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {CALENDAR_EVENT_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {mode === 'edit' ? (
                    <div className="space-y-2">
                      <FieldLabel>Status</FieldLabel>
                      <Select
                        value={values.status}
                        onValueChange={(value: CalendarEventStatusDTO) =>
                          setValues((current) => ({ ...current, status: value }))
                        }
                      >
                        <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-status">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {CALENDAR_EVENT_STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <FieldLabel>Turma</FieldLabel>
                      <Select
                        value={values.turmaId || EMPTY_VALUE}
                        onValueChange={(value) =>
                          setValues((current) => ({ ...current, turmaId: value === EMPTY_VALUE ? '' : value }))
                        }
                      >
                        <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-turma">
                          <SelectValue placeholder="Sem turma" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_VALUE}>Sem turma</SelectItem>
                          {resources.turmas.map((turma) => (
                            <SelectItem key={turma.id} value={turma.id}>
                              {turma.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {mode === 'edit' ? (
                    <div className="space-y-2">
                      <FieldLabel>Turma</FieldLabel>
                      <Select
                        value={values.turmaId || EMPTY_VALUE}
                        onValueChange={(value) =>
                          setValues((current) => ({ ...current, turmaId: value === EMPTY_VALUE ? '' : value }))
                        }
                      >
                        <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-turma">
                          <SelectValue placeholder="Sem turma" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_VALUE}>Sem turma</SelectItem>
                          {resources.turmas.map((turma) => (
                            <SelectItem key={turma.id} value={turma.id}>
                              {turma.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <FieldLabel>Início</FieldLabel>
                    <DateTimeField
                      id="agenda-event-start"
                      value={values.startAt}
                      onChange={(value) => setValues((current) => ({ ...current, startAt: value }))}
                      testId="agenda-event-start"
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>Fim</FieldLabel>
                    <DateTimeField
                      id="agenda-event-end"
                      value={values.endAt}
                      onChange={(value) => setValues((current) => ({ ...current, endAt: value }))}
                      testId="agenda-event-end"
                    />
                  </div>
                </div>
              </SectionBlock>

              <SectionBlock
                title="Alocação e contexto"
                description="Associe sala, professor e observações operacionais para manter o evento rastreável."
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>Sala</FieldLabel>
                    <Select
                      value={values.salaId || EMPTY_VALUE}
                      onValueChange={(value) =>
                        setValues((current) => ({ ...current, salaId: value === EMPTY_VALUE ? '' : value }))
                      }
                    >
                      <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-sala">
                        <SelectValue placeholder="Sem sala" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY_VALUE}>Sem sala</SelectItem>
                        {resources.salas.map((sala) => (
                          <SelectItem key={sala.id} value={sala.id}>
                            {sala.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>Professor</FieldLabel>
                    <Select
                      value={values.professorId || EMPTY_VALUE}
                      onValueChange={(value) =>
                        setValues((current) => ({ ...current, professorId: value === EMPTY_VALUE ? '' : value }))
                      }
                    >
                      <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="agenda-event-professor">
                        <SelectValue placeholder="Sem professor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY_VALUE}>Sem professor</SelectItem>
                        {resources.professores.map((professor) => (
                          <SelectItem key={professor.id} value={professor.id}>
                            {professor.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel>Descrição</FieldLabel>
                    <Textarea
                      value={values.description}
                      onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
                      className="min-h-[120px] rounded-2xl border-slate-200 bg-white"
                      placeholder="Observações rápidas, instruções internas ou contexto operacional."
                    />
                  </div>
                </div>
              </SectionBlock>

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-100 px-6 py-4 sm:justify-between sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
              disabled={submitting}
              data-testid="agenda-event-submit"
            >
              {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Criar evento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DateTimeFieldProps = {
  id: string;
  value: string;
  placeholder?: string;
  onChange: (_value: string) => void;
  testId?: string;
};

function DateTimeField({ id, value, placeholder = 'dd/mm/aaaa', onChange, testId }: DateTimeFieldProps) {
  const { date, time } = parseLocalDateTime(value);

  return (
    <div className="relative grid grid-cols-[minmax(0,1fr)_120px] gap-2">
      {testId ? (
        <input
          type="datetime-local"
          step="60"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute right-2 top-2 h-4 w-4 opacity-0"
        />
      ) : null}

      <DatePicker
        id={id}
        variant="input"
        value={date}
        onChange={(nextDate) => onChange(buildLocalDateTime(nextDate, time || '00:00'))}
        placeholder={placeholder}
        className={CONTROL_CLASS}
      />
      <Input
        type="time"
        step="60"
        value={time}
        onChange={(event) => onChange(buildLocalDateTime(date, event.target.value))}
        className={CONTROL_CLASS}
        placeholder="--:--"
        disabled={!date}
      />
    </div>
  );
}
