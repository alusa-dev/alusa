'use client';

import { useEffect, useState } from 'react';
import { TZDateMini } from '@date-fns/tz';
import { addHours } from 'date-fns';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { pushToast } from '@/components/ui/toast';
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
import { AulasApiRequestError } from '@/features/aulas/calendar/services/aulas-api';
import { CALENDAR_EVENT_STATUS_OPTIONS, CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/aulas/types';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  getDefaultStartNaive,
  normalizeAccountTimeZoneClient,
  utcIsoToZonedNaive,
  zonedNaiveToUtcIso,
} from '@/lib/agenda-timezone';
import { cn } from '@/lib/utils';

type CalendarEventDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  resources: {
    turmas: AulasLookupItemDTO[];
    professores: AulasLookupItemDTO[];
    salas: AulasLookupItemDTO[];
  };
  accountTimeZone?: string;
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
const CONTROL_CLASS = 'h-10 rounded-xl border-slate-200 bg-white text-[13px] alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]';
const CREATE_EVENT_TYPE_OPTIONS = CALENDAR_EVENT_TYPE_OPTIONS.filter((option) => option.value !== 'AULA_EXPERIMENTAL');

function wallCalendarPickerDate(year: number, month: number, day: number, accountTz: string) {
  return new Date(
    new TZDateMini(year, month - 1, day, 12, 0, 0, 0, normalizeAccountTimeZoneClient(accountTz)).getTime(),
  );
}

function parseNaiveDateTimeField(value: string, accountTz: string) {
  if (!value) {
    return { date: undefined as Date | undefined, time: '' };
  }

  const [datePart, timePart = ''] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);

  if (!year || !month || !day) {
    return { date: undefined as Date | undefined, time: '' };
  }

  return {
    date: wallCalendarPickerDate(year, month, day, accountTz),
    time: timePart.slice(0, 5),
  };
}

function calendarDateToZonedNaive(date: Date, time: string, accountTz: string) {
  const z = new TZDateMini(date.getTime(), normalizeAccountTimeZoneClient(accountTz));
  const pad = (input: number) => String(input).padStart(2, '0');
  const hhmm = time.slice(0, 5) || '00:00';
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}T${hhmm}`;
}

function shiftEndAtOneHour(startNaive: string, accountTz: string) {
  const iso = zonedNaiveToUtcIso(startNaive, accountTz);
  if (Number.isNaN(new Date(iso).getTime())) {
    return '';
  }

  const next = addHours(new Date(iso), 1);
  return utcIsoToZonedNaive(next.toISOString(), accountTz);
}

function buildEmptyForm(accountTz: string): EventFormState {
  const start = getDefaultStartNaive(accountTz);
  return {
    title: '',
    description: '',
    type: 'AULA',
    status: 'AGENDADO',
    startAt: start,
    endAt: shiftEndAtOneHour(start, accountTz),
    turmaId: '',
    salaId: '',
    professorId: '',
  };
}

function buildAgendaEventToast(error: unknown) {
  if (error instanceof AulasApiRequestError) {
    if (error.code === 'CONFLITO_SALA_PROFESSOR' || error.status === 409) {
      return {
        title: 'Conflito de agenda',
        description:
          error.message ||
          'Já existe outro compromisso usando a mesma sala ou professor nesse horário. Ajuste o horário e tente novamente.',
        variant: 'error' as const,
      };
    }

    if (error.status === 422) {
      return {
        title: 'Não foi possível salvar o evento',
        description:
          error.message === 'endAt must be after startAt'
            ? 'O horário de término precisa ser depois do horário de início.'
            : error.message || 'Revise os dados do evento e tente novamente.',
        variant: 'error' as const,
      };
    }

    return {
      title: 'Falha ao salvar o evento',
      description: error.message || 'Tivemos um problema para salvar o evento agora.',
      variant: 'error' as const,
    };
  }

  return {
    title: 'Falha ao salvar o evento',
    description:
      error instanceof Error && error.message
        ? error.message
        : 'Tivemos um problema para salvar o evento agora. Tente novamente em instantes.',
    variant: 'error' as const,
  };
}

function FieldLabel({ children }: { children: string }) {
  return <label className="text-xs font-medium uppercase tracking-wide text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">{children}</label>;
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
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{title}</h3>
        <p className="mt-1 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function CalendarEventDialog({
  open,
  mode,
  resources,
  accountTimeZone = DEFAULT_ACCOUNT_TIMEZONE,
  initialEvent,
  onOpenChange,
  onSaved,
}: CalendarEventDialogProps) {
  const tz = accountTimeZone;
  const [values, setValues] = useState<EventFormState>(() => buildEmptyForm(tz));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setValues(buildEmptyForm(tz));
      setSubmitting(false);
      return;
    }

    if (!initialEvent) return;

    setValues({
      title: initialEvent.title,
      description: initialEvent.description ?? '',
      type: initialEvent.type,
      status: initialEvent.status,
      startAt: utcIsoToZonedNaive(initialEvent.startAt, tz),
      endAt: utcIsoToZonedNaive(initialEvent.endAt, tz),
      turmaId: initialEvent.turma?.id ?? '',
      salaId: initialEvent.sala?.id ?? '',
      professorId: initialEvent.professores[0]?.id ?? '',
    });
  }, [initialEvent, open, tz]);

  async function handleSubmit() {
    try {
      setSubmitting(true);

      const startIso = zonedNaiveToUtcIso(values.startAt, tz);
      const endIso = zonedNaiveToUtcIso(values.endAt, tz);

      if (!values.startAt || Number.isNaN(new Date(startIso).getTime())) {
        throw new Error('Informe uma data e hora de início válidas.');
      }

      if (!values.endAt || Number.isNaN(new Date(endIso).getTime())) {
        throw new Error('Informe uma data e hora de fim válidas.');
      }

      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        throw new Error('O horário de término precisa ser depois do horário de início.');
      }

      const payload = {
        title: values.title.trim(),
        description: values.description.trim() || null,
        type: values.type,
        status: mode === 'edit' ? values.status : undefined,
        startAt: startIso,
        endAt: endIso,
        turmaId: values.turmaId || null,
        salaId: values.salaId || null,
        professorIds: values.professorId ? [values.professorId] : [],
      };

      if (mode === 'edit' && initialEvent) {
        await updateAgendaEvent(initialEvent.id, payload);
      } else {
        await createAgendaEvent(payload);
      }

      pushToast({
        title: mode === 'edit' ? 'Evento atualizado' : 'Evento criado',
        description:
          mode === 'edit'
            ? 'As alterações foram salvas e a agenda foi atualizada.'
            : 'O evento foi salvo com sucesso na agenda.',
        variant: 'success',
      });

      onSaved();
      onOpenChange(false);
    } catch (err) {
      pushToast(buildAgendaEventToast(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleStartAtChange(nextStartAt: string) {
    setValues((current) => {
      const startMs = new Date(zonedNaiveToUtcIso(nextStartAt, tz)).getTime();
      const endMs = current.endAt
        ? new Date(zonedNaiveToUtcIso(current.endAt, tz)).getTime()
        : Number.NaN;
      const shouldShiftEndAt = !current.endAt || (!Number.isNaN(endMs) && endMs <= startMs);

      return {
        ...current,
        startAt: nextStartAt,
        endAt: shouldShiftEndAt ? shiftEndAtOneHour(nextStartAt, tz) : current.endAt,
      };
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl gap-0 overflow-hidden rounded-3xl p-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="flex h-full max-h-[85vh] flex-col bg-white alusa-dark:bg-[color:var(--color-bg-card)]"
        >
          <DialogHeader className="border-b border-slate-100 px-6 py-5 alusa-dark:border-[color:var(--color-border-default)]">
            <DialogTitle className="text-lg font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
              {mode === 'edit' ? 'Editar evento' : 'Novo evento'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
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
                          {(mode === 'create' ? CREATE_EVENT_TYPE_OPTIONS : CALENDAR_EVENT_TYPE_OPTIONS).map((option) => (
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
                      onChange={handleStartAtChange}
                      testId="agenda-event-start"
                      accountTz={tz}
                    />
                  </div>

                  <div className="space-y-2">
                    <FieldLabel>Fim</FieldLabel>
                    <DateTimeField
                      id="agenda-event-end"
                      value={values.endAt}
                      onChange={(value) => setValues((current) => ({ ...current, endAt: value }))}
                      testId="agenda-event-end"
                      accountTz={tz}
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
                      className="min-h-[120px] rounded-2xl border-slate-200 bg-white alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]"
                      placeholder="Observações rápidas, instruções internas ou contexto operacional."
                    />
                  </div>
                </div>
              </SectionBlock>

            </div>
          </div>

          <DialogFooter className="border-t border-slate-100 px-6 py-4 alusa-dark:border-[color:var(--color-border-default)] sm:justify-between sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-transparent alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)]"
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
  accountTz: string;
};

function DateTimeField({ id, value, placeholder = 'dd/mm/aaaa', onChange, testId, accountTz }: DateTimeFieldProps) {
  const { date, time } = parseNaiveDateTimeField(value, accountTz);

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
        onChange={(nextDate) =>
          nextDate ? onChange(calendarDateToZonedNaive(nextDate, time || '00:00', accountTz)) : onChange('')
        }
        placeholder={placeholder}
        className={CONTROL_CLASS}
      />
      <Input
        type="time"
        step="60"
        value={time}
        onChange={(event) =>
          date ? onChange(calendarDateToZonedNaive(date, event.target.value, accountTz)) : undefined
        }
        className={CONTROL_CLASS}
        placeholder="--:--"
        disabled={!date}
      />
    </div>
  );
}
