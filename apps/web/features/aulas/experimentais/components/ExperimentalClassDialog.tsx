'use client';

import { useEffect, useMemo, useState } from 'react';

import { InfoCircle, Plus, Trash2 } from '@/components/icons/icons';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AutocompleteList, type AutocompleteOption } from '@/components/matriculas/wizard/shared/AutocompleteList';
import type {
  AulasTurmaLookupItemDTO,
  CalendarEventDetailsDTO,
  ExperimentalClassStatusDTO,
} from '@/features/aulas/dtos';
import {
  createExperimentalClass,
  searchExperimentalStudents,
  updateExperimentalClass,
} from '@/features/aulas/experimentais/services/experimental-service';
import { AulasApiRequestError } from '@/features/aulas/calendar/services/aulas-api';
import { TZDateMini } from '@date-fns/tz';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatInstantInAccountZone,
  normalizeAccountTimeZoneClient,
  utcIsoToZonedNaive,
} from '@/lib/agenda-timezone';
import { cn } from '@/lib/utils';

type ExperimentalClassDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  resources: {
    turmas: AulasTurmaLookupItemDTO[];
  };
  initialEvent?: CalendarEventDetailsDTO | null;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
  accountTimeZone?: string;
};

type ExperimentalScheduleItem = {
  id: string;
  turmaId: string;
  salaId: string;
  professorId: string;
  selectedDates: string[];
};

type ExperimentalFormState = {
  alunoId: string;
  alunoLabel: string;
  observacao: string;
  status: ExperimentalClassStatusDTO;
  scheduleItems: ExperimentalScheduleItem[];
};

type StudentResult = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
};

const EMPTY_VALUE = '__NONE__';
const CONTROL_CLASS =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const SECTION_CLASS = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const LABEL_CLASS = 'text-xs font-medium text-slate-600';
const SUPPORT_TEXT_CLASS = 'text-xs text-slate-500';
const FIELD_HEADER_CLASS = 'flex h-5 items-center gap-2';
const DAY_INDEX_BY_CODE: Record<string, number> = {
  DOM: 0,
  DOMINGO: 0,
  SEG: 1,
  SEGUNDA: 1,
  TER: 2,
  TERCA: 2,
  TERÇA: 2,
  QUA: 3,
  QUARTA: 3,
  QUI: 4,
  QUINTA: 4,
  SEX: 5,
  SEXTA: 5,
  SAB: 6,
  SÁB: 6,
  SABADO: 6,
  SÁBADO: 6,
};
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

function toDateKey(date: Date) {
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(value: string) {
  if (!value) return undefined;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;

  return new Date(year, month - 1, day);
}

function normalizeSelectedDates(dates: Date[]) {
  return Array.from(new Set(dates.map((date) => toDateKey(date)))).sort();
}

function buildLocalDateTime(date?: Date, time = '') {
  if (!date) return '';

  const hours = time.slice(0, 2) || '00';
  const minutes = time.slice(3, 5) || '00';
  const pad = (input: number) => String(input).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hours}:${minutes}`;
}

function normalizeDayCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function resolveNextTurmaDate(baseDate: Date, daysOfWeek: string[]) {
  const normalizedDays = daysOfWeek
    .map((day) => DAY_INDEX_BY_CODE[normalizeDayCode(day)])
    .filter((day): day is number => Number.isInteger(day));

  if (!normalizedDays.length) {
    return baseDate;
  }

  if (normalizedDays.includes(baseDate.getDay())) {
    return baseDate;
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const next = new Date(baseDate);
    next.setDate(baseDate.getDate() + offset);
    if (normalizedDays.includes(next.getDay())) {
      return next;
    }
  }

  return baseDate;
}

function resolveAllowedTurmaDays(daysOfWeek: string[]) {
  return daysOfWeek
    .map((day) => DAY_INDEX_BY_CODE[normalizeDayCode(day)])
    .filter((day): day is number => Number.isInteger(day));
}

function isDateOutsideTurmaSchedule(date: Date, allowedDays: number[]) {
  if (!allowedDays.length) {
    return false;
  }

  return !allowedDays.includes(date.getDay());
}

function buildIsoForTurmaSlot(
  dateKey: string,
  turma: AulasTurmaLookupItemDTO | undefined,
  edge: 'start' | 'end',
  accountTz: string,
) {
  if (!dateKey || !turma?.defaultSchedule) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return '';

  const hhmm = edge === 'start' ? turma.defaultSchedule.startTime : turma.defaultSchedule.endTime;
  const [hh, mm] = hhmm.split(':').map(Number);
  const z = new TZDateMini(y, m - 1, d, hh ?? 0, mm ?? 0, 0, 0, normalizeAccountTimeZoneClient(accountTz));

  return new Date(z.getTime()).toISOString();
}

function buildDateTimeForTurma(date: Date | undefined, turma: AulasTurmaLookupItemDTO | undefined, edge: 'start' | 'end') {
  if (!date || !turma?.defaultSchedule) {
    return '';
  }

  return buildLocalDateTime(
    date,
    edge === 'start' ? turma.defaultSchedule.startTime : turma.defaultSchedule.endTime,
  );
}

function applyTurmaDefaultsToValues(
  current: ExperimentalScheduleItem,
  turma: AulasTurmaLookupItemDTO | undefined,
) {
  if (!turma?.defaultSchedule) {
    return current;
  }

  const baseDate = parseDateKey(current.selectedDates[0] ?? '') ?? new Date();
  const nextDate = resolveNextTurmaDate(baseDate, turma.defaultSchedule.daysOfWeek);

  return {
    ...current,
    turmaId: turma.id,
    salaId: turma.defaultSchedule.salaId ?? '',
    professorId: turma.defaultSchedule.professorIds[0] ?? '',
    selectedDates: [toDateKey(nextDate)],
  };
}

function buildUniqueId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}`;
}

function buildUiRequestId() {
  return buildUniqueId('experimental');
}

function buildScheduleItem(overrides?: Partial<ExperimentalScheduleItem>): ExperimentalScheduleItem {
  return {
    id: buildUniqueId('schedule-item'),
    turmaId: '',
    salaId: '',
    professorId: '',
    selectedDates: [],
    ...overrides,
  };
}

function getInitialValues(): ExperimentalFormState {
  return {
    alunoId: '',
    alunoLabel: '',
    observacao: '',
    status: 'AGENDADA',
    scheduleItems: [buildScheduleItem()],
  };
}

function FieldLabel({ children }: { children: string }) {
  return <label className={LABEL_CLASS}>{children}</label>;
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
    <section className={SECTION_CLASS}>
      <div>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

function formatPluralLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildExperimentalToastMessage(params: {
  error: unknown;
  createdCount?: number;
  requestedCount?: number;
}) {
  const { error, createdCount = 0, requestedCount = 0 } = params;
  const hasPartialSuccess = createdCount > 0;

  if (error instanceof AulasApiRequestError) {
    if (error.code === 'CONFLITO_SALA_PROFESSOR' || error.status === 409) {
      return {
        title: hasPartialSuccess ? 'Agendamento concluído parcialmente' : 'Horário indisponível para essa experimental',
        description: hasPartialSuccess
          ? `${formatPluralLabel(createdCount, 'agendamento foi salvo', 'agendamentos foram salvos')}. ${error.message} Revise a turma ou a data restante para concluir o que faltou.`
          : `${error.message} Escolha outro dia da turma ou ajuste o agendamento para evitar sobreposição.`,
        variant: hasPartialSuccess ? ('warning' as const) : ('error' as const),
      };
    }

    if (error.code === 'ALUNO_NAO_ELEGIVEL') {
      return {
        title: 'Aluno indisponível para aula experimental',
        description: 'Selecione um aluno ativo e tente novamente.',
        variant: 'error' as const,
      };
    }

    if (error.code === 'TURMA_NAO_ENCONTRADA') {
      return {
        title: 'Turma indisponível',
        description: 'A turma escolhida não está mais disponível. Atualize a agenda e selecione outra turma.',
        variant: 'error' as const,
      };
    }

    if (error.status === 422) {
      return {
        title: 'Não foi possível validar o agendamento',
        description: error.message || 'Revise os dados informados e tente novamente.',
        variant: 'error' as const,
      };
    }

    if (error.status === 404) {
      return {
        title: 'Recurso não encontrado',
        description: error.message || 'Atualize a agenda e tente novamente.',
        variant: 'error' as const,
      };
    }

    return {
      title: hasPartialSuccess ? 'Agendamento concluído parcialmente' : 'Não foi possível agendar a aula experimental',
      description: hasPartialSuccess
        ? `${formatPluralLabel(createdCount, 'agendamento foi salvo', 'agendamentos foram salvos')}. ${error.message}`
        : error.message,
      variant: hasPartialSuccess ? ('warning' as const) : ('error' as const),
    };
  }

  const fallbackMessage =
    error instanceof Error && error.message
      ? error.message
      : 'Tivemos um problema para concluir o agendamento. Tente novamente em instantes.';

  return {
    title: hasPartialSuccess ? 'Agendamento concluído parcialmente' : 'Não foi possível agendar a aula experimental',
    description: hasPartialSuccess
      ? `${formatPluralLabel(createdCount, 'agendamento foi salvo', 'agendamentos foram salvos')} de ${requestedCount}. ${fallbackMessage}`
      : fallbackMessage,
    variant: hasPartialSuccess ? ('warning' as const) : ('error' as const),
  };
}

export function ExperimentalClassDialog({
  open,
  mode,
  resources,
  initialEvent,
  onOpenChange,
  onSaved,
  accountTimeZone = DEFAULT_ACCOUNT_TIMEZONE,
}: ExperimentalClassDialogProps) {
  const tz = accountTimeZone;
  const [values, setValues] = useState<ExperimentalFormState>(getInitialValues);
  const [submitting, setSubmitting] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedTurmaIds = useMemo(
    () => new Set(values.scheduleItems.map((item) => item.turmaId).filter(Boolean)),
    [values.scheduleItems],
  );

  function resolveTurmaById(turmaId: string) {
    return resources.turmas.find((item) => item.id === turmaId);
  }

  useEffect(() => {
    if (!open) {
      setValues(getInitialValues());
      setSubmitting(false);
      setStudentQuery('');
      setStudentResults([]);
      setSearchLoading(false);
      setShowSuggestions(false);
      setHighlightedIndex(0);
      return;
    }

    if (!initialEvent?.experimental) return;

    setValues({
      alunoId: initialEvent.experimental.aluno.id,
      alunoLabel: initialEvent.experimental.aluno.label,
      observacao: initialEvent.experimental.observacao ?? '',
      status: initialEvent.experimental.status,
      scheduleItems: [
        buildScheduleItem({
          turmaId: initialEvent.turma?.id ?? '',
          salaId: initialEvent.sala?.id ?? '',
          professorId: initialEvent.professores[0]?.id ?? '',
          selectedDates: [formatInstantInAccountZone(initialEvent.startAt, 'yyyy-MM-dd', tz)],
        }),
      ],
    });
    setStudentQuery(initialEvent.experimental.aluno.label);
  }, [initialEvent, open, tz]);

  useEffect(() => {
    if (!open) return;

    const normalized = studentQuery.trim();
    const shouldSearch = normalized.length >= 2 && normalized !== values.alunoLabel;

    if (!shouldSearch) {
      setStudentResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        const result = await searchExperimentalStudents(normalized);
        if (!cancelled) {
          setStudentResults(result);
          setHighlightedIndex(0);
        }
      } catch (err) {
        if (!cancelled) {
          pushToast({
            title: 'Não foi possível buscar alunos',
            description:
              err instanceof Error && err.message
                ? err.message
                : 'Tente novamente em instantes para continuar o agendamento.',
            variant: 'error',
          });
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, studentQuery, values.alunoLabel]);

  const studentOptions = useMemo<AutocompleteOption[]>(() => {
    return studentResults.map((item) => ({
      value: item.id,
      label: item.nome,
      description: [item.email, item.telefone].filter(Boolean).join(' • ') || 'Aluno cadastrado',
    }));
  }, [studentResults]);

  function handleStudentSelect(option: AutocompleteOption) {
    setValues((current) => ({
      ...current,
      alunoId: option.value,
      alunoLabel: option.label,
    }));
    setStudentQuery(option.label);
    setStudentResults([]);
    setShowSuggestions(false);
    setHighlightedIndex(0);
  }

  function updateScheduleItem(
    itemId: string,
    updater: (_item: ExperimentalScheduleItem) => ExperimentalScheduleItem,
  ) {
    setValues((current) => ({
      ...current,
      scheduleItems: current.scheduleItems.map((item) => (item.id === itemId ? updater(item) : item)),
    }));
  }

  function handleTurmaChange(itemId: string, value: string) {
    if (value === EMPTY_VALUE) {
      updateScheduleItem(itemId, (item) => buildScheduleItem({ id: item.id }));
      return;
    }

    const turma = resolveTurmaById(value);
    updateScheduleItem(itemId, (item) => applyTurmaDefaultsToValues({ ...item, turmaId: value }, turma));
  }

  function handleDateChange(itemId: string, nextDate: Date | undefined) {
    updateScheduleItem(itemId, (item) => {
      const turma = resolveTurmaById(item.turmaId);
      const allowedTurmaDays = resolveAllowedTurmaDays(turma?.defaultSchedule?.daysOfWeek ?? []);

      if (!nextDate) {
        return {
          ...item,
          selectedDates: [],
        };
      }

      return {
        ...item,
        selectedDates:
          turma?.defaultSchedule && !isDateOutsideTurmaSchedule(nextDate, allowedTurmaDays)
            ? [toDateKey(nextDate)]
            : item.selectedDates,
      };
    });
  }

  function handleDatesChange(itemId: string, nextDates: Date[] | undefined) {
    updateScheduleItem(itemId, (item) => {
      const turma = resolveTurmaById(item.turmaId);
      const allowedTurmaDays = resolveAllowedTurmaDays(turma?.defaultSchedule?.daysOfWeek ?? []);
      const validDates = (nextDates ?? []).filter((date) => !isDateOutsideTurmaSchedule(date, allowedTurmaDays));

      return {
        ...item,
        selectedDates: normalizeSelectedDates(validDates),
      };
    });
  }

  function handleAddScheduleItem() {
    setValues((current) => ({
      ...current,
      scheduleItems: [...current.scheduleItems, buildScheduleItem()],
    }));
  }

  function handleRemoveScheduleItem(itemId: string) {
    setValues((current) => ({
      ...current,
      scheduleItems:
        current.scheduleItems.length === 1
          ? current.scheduleItems
          : current.scheduleItems.filter((item) => item.id !== itemId),
    }));
  }

  async function handleSubmit() {
    let createdCount = 0;

    try {
      setSubmitting(true);

      if (!values.alunoId) {
        throw new Error('Selecione um aluno já cadastrado para a aula experimental.');
      }

      const filledItems = values.scheduleItems.filter(
        (item) => item.turmaId || item.selectedDates.length,
      );

      if (!filledItems.length) {
        throw new Error('Adicione pelo menos uma turma para a aula experimental.');
      }

      const requestedCount = filledItems.reduce((total, item) => total + item.selectedDates.length, 0);

      const turmaIds = filledItems.map((item) => item.turmaId).filter(Boolean);
      if (mode === 'create' && turmaIds.length !== new Set(turmaIds).size) {
        throw new Error('Cada turma pode ser adicionada apenas uma vez no mesmo agendamento.');
      }

      for (const item of filledItems) {
        if (!item.turmaId) {
          throw new Error('Selecione a turma em todos os blocos adicionados.');
        }

        if (!item.selectedDates.length) {
          throw new Error('Selecione ao menos uma data válida dentro da agenda da turma em todos os blocos.');
        }
      }

      if (mode === 'edit' && initialEvent?.experimental) {
        const [item] = filledItems;
        const turma = resolveTurmaById(item.turmaId);
        const dateKey = item.selectedDates[0] ?? '';
        const startAt = buildIsoForTurmaSlot(dateKey, turma, 'start', tz);
        const endAt = buildIsoForTurmaSlot(dateKey, turma, 'end', tz);

        if (!startAt || !endAt) {
          throw new Error('Não foi possível aplicar o horário padrão da turma para a data selecionada.');
        }

        await updateExperimentalClass(initialEvent.experimental.id, {
          alunoId: values.alunoId,
          turmaId: item.turmaId,
          salaId: item.salaId || null,
          professorIds: item.professorId ? [item.professorId] : [],
          observacao: values.observacao.trim() || null,
          status: values.status,
          startAt,
          endAt,
        });

        pushToast({
          title: 'Aula experimental atualizada',
          description: 'O agendamento foi atualizado com sucesso na agenda.',
          variant: 'success',
        });
      } else {
        const batchRequestId = buildUiRequestId();

        for (const item of filledItems) {
          const turma = resolveTurmaById(item.turmaId);

          for (const dateKey of item.selectedDates) {
            const startAt = buildIsoForTurmaSlot(dateKey, turma, 'start', tz);
            const endAt = buildIsoForTurmaSlot(dateKey, turma, 'end', tz);

            if (!startAt || !endAt) {
              throw new Error('Não foi possível aplicar o horário padrão da turma para uma das datas selecionadas.');
            }

            await createExperimentalClass({
              alunoId: values.alunoId,
              turmaId: item.turmaId,
              salaId: item.salaId || null,
              professorIds: item.professorId ? [item.professorId] : [],
              observacao: values.observacao.trim() || null,
              startAt,
              endAt,
              uiRequestId: `${batchRequestId}-${item.id}-${dateKey}`,
            });
            createdCount += 1;
          }
        }

        pushToast({
          title: requestedCount > 1 ? 'Aulas experimentais agendadas' : 'Aula experimental agendada',
          description:
            requestedCount > 1
              ? `${formatPluralLabel(requestedCount, 'agendamento foi criado', 'agendamentos foram criados')} com sucesso.`
              : 'O agendamento foi salvo com sucesso na agenda.',
          variant: 'success',
        });
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      const requestedCount = values.scheduleItems.reduce(
        (total, item) => total + item.selectedDates.length,
        0,
      );
      const toastMessage = buildExperimentalToastMessage({
        error: err,
        createdCount,
        requestedCount,
      });

      pushToast(toastMessage);

      if (createdCount > 0) {
        onSaved();
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl gap-0 overflow-hidden p-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="flex h-full max-h-[85vh] flex-col bg-white"
        >
          <DialogHeader className="border-b border-slate-200 px-8 py-6">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              {mode === 'edit' ? 'Editar aula experimental' : 'Nova aula experimental'}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              Selecione um aluno já cadastrado e reserve o horário da visita sem misturar esse fluxo com matrícula.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[76vh] overflow-y-auto px-8 py-6">
            <div className="space-y-6">
              <SectionBlock
                title="Aluno"
                description="A aula experimental só pode ser agendada para aluno já cadastrado no sistema."
              >
                <div className="space-y-2">
                  <FieldLabel>Buscar aluno</FieldLabel>
                  <div className="relative">
                    <Input
                      value={studentQuery}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setStudentQuery(nextValue);
                        setShowSuggestions(true);

                        if (nextValue !== values.alunoLabel) {
                          setValues((current) => ({
                            ...current,
                            alunoId: '',
                            alunoLabel: '',
                          }));
                        }
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => {
                        window.setTimeout(() => setShowSuggestions(false), 120);
                      }}
                      onKeyDown={(event) => {
                        if (!studentOptions.length) return;

                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          setHighlightedIndex((current) => Math.min(current + 1, studentOptions.length - 1));
                        }

                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          setHighlightedIndex((current) => Math.max(current - 1, 0));
                        }

                        if (event.key === 'Enter') {
                          event.preventDefault();
                          const option = studentOptions[highlightedIndex];
                          if (option) {
                            handleStudentSelect(option);
                          }
                        }

                        if (event.key === 'Escape') {
                          setShowSuggestions(false);
                        }
                      }}
                      className={CONTROL_CLASS}
                      placeholder="Digite pelo menos 2 letras do nome do aluno"
                      data-testid="experimental-student-search"
                    />

                    {showSuggestions && (studentQuery.trim().length >= 2 || searchLoading) ? (
                      <AutocompleteList
                        id="experimental-students"
                        options={studentOptions}
                        highlightedIndex={highlightedIndex}
                        selectedValue={values.alunoId || undefined}
                        onSelect={handleStudentSelect}
                        renderDescription={(option) => option.description}
                        className="rounded-2xl border-slate-200 shadow-xl"
                      />
                    ) : null}
                  </div>

                  <p className={SUPPORT_TEXT_CLASS}>
                    {values.alunoId
                      ? `Aluno selecionado: ${values.alunoLabel}`
                      : searchLoading
                        ? 'Buscando alunos cadastrados...'
                        : 'Se o aluno não existir, finalize o cadastro dele antes de agendar a experimental.'}
                  </p>
                </div>
              </SectionBlock>

              <SectionBlock
                title="Agendamento"
                description="Associe a experimental ao contexto acadêmico e operacional correto da Agenda."
              >
                <div className="space-y-4">
                  {values.scheduleItems.map((item, index) => {
                    const selectedTurma = resolveTurmaById(item.turmaId);
                    const allowedTurmaDays = resolveAllowedTurmaDays(
                      selectedTurma?.defaultSchedule?.daysOfWeek ?? [],
                    );
                    const selectedDates = item.selectedDates
                      .map((value) => parseDateKey(value))
                      .filter((value): value is Date => Boolean(value));
                    const primarySelectedDate = selectedDates[0];
                    const dk = item.selectedDates[0];
                    const computedStartAt =
                      dk && selectedTurma
                        ? utcIsoToZonedNaive(buildIsoForTurmaSlot(dk, selectedTurma, 'start', tz), tz)
                        : '';
                    const computedEndAt =
                      dk && selectedTurma
                        ? utcIsoToZonedNaive(buildIsoForTurmaSlot(dk, selectedTurma, 'end', tz), tz)
                        : '';

                    return (
                      <div
                        key={item.id}
                        className="space-y-4 rounded-lg border border-slate-200 bg-white px-4 py-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-slate-700">
                            {index === 0 ? 'Turma principal' : `Turma ${index + 1}`}
                          </span>
                          {mode === 'create' && values.scheduleItems.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveScheduleItem(item.id)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-rose-600"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </button>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <div className={FIELD_HEADER_CLASS}>
                              <FieldLabel>Turma</FieldLabel>
                            </div>
                            <Select
                              value={item.turmaId || EMPTY_VALUE}
                              onValueChange={(value) => handleTurmaChange(item.id, value)}
                            >
                              <SelectTrigger
                                className={cn(CONTROL_CLASS, 'w-full')}
                                data-testid={index === 0 ? 'experimental-turma' : undefined}
                              >
                                <SelectValue placeholder="Selecione a turma" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={EMPTY_VALUE}>Selecione</SelectItem>
                                {resources.turmas.map((turma) => {
                                  const isAlreadySelected =
                                    selectedTurmaIds.has(turma.id) && turma.id !== item.turmaId;

                                  return (
                                    <SelectItem key={turma.id} value={turma.id} disabled={isAlreadySelected}>
                                      {turma.label}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <div className={FIELD_HEADER_CLASS}>
                              <FieldLabel>Data da aula</FieldLabel>
                              <TooltipProvider delayDuration={120}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex h-4 w-4 items-center justify-center text-slate-400 transition hover:text-slate-600"
                                      aria-label="Entender disponibilidade do calendário"
                                    >
                                      <InfoCircle className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-56 border-slate-200 text-slate-600">
                                    Apenas os dias configurados na grade da turma ficam disponíveis para agendamento.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            {mode === 'create' ? (
                              <DatePicker
                                id={`experimental-start-${item.id}`}
                                variant="input"
                                mode="multiple"
                                value={selectedDates}
                                onChange={(dates) => handleDatesChange(item.id, dates)}
                                onRemoveDate={(date) => {
                                  handleDatesChange(
                                    item.id,
                                    selectedDates.filter((current) => current.getTime() !== date.getTime()),
                                  );
                                }}
                                placeholder="Selecione um ou mais dias da turma"
                                className={CONTROL_CLASS}
                                disabled={!selectedTurma}
                                disabledDays={(date) => isDateOutsideTurmaSchedule(date, allowedTurmaDays)}
                                readOnlyInput
                              />
                            ) : (
                              <DatePicker
                                id={`experimental-start-${item.id}`}
                                variant="input"
                                value={primarySelectedDate}
                                onChange={(date) => handleDateChange(item.id, date)}
                                placeholder="Selecione um dia da turma"
                                className={CONTROL_CLASS}
                                disabled={!selectedTurma}
                                disabledDays={(date) => isDateOutsideTurmaSchedule(date, allowedTurmaDays)}
                                readOnlyInput
                              />
                            )}
                            <input
                              type="datetime-local"
                              step="60"
                              value={computedStartAt}
                              readOnly
                              data-testid={index === 0 ? 'experimental-start' : undefined}
                              aria-hidden="true"
                              tabIndex={-1}
                              className="sr-only"
                            />
                            <input
                              type="datetime-local"
                              step="60"
                              value={computedEndAt}
                              readOnly
                              data-testid={index === 0 ? 'experimental-end' : undefined}
                              aria-hidden="true"
                              tabIndex={-1}
                              className="sr-only"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {mode === 'create' ? (
                    <button
                      type="button"
                      onClick={handleAddScheduleItem}
                      className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-slate-900"
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar mais uma turma
                    </button>
                  ) : null}

                  {mode === 'edit' ? (
                    <div className="space-y-2">
                      <FieldLabel>Status</FieldLabel>
                      <Select
                        value={values.status}
                        onValueChange={(value: ExperimentalClassStatusDTO) =>
                          setValues((current) => ({ ...current, status: value }))
                        }
                      >
                        <SelectTrigger className={cn(CONTROL_CLASS, 'w-full')} data-testid="experimental-status">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AGENDADA">Agendada</SelectItem>
                          <SelectItem value="REAGENDADA">Reagendada</SelectItem>
                          <SelectItem value="REALIZADA">Realizada</SelectItem>
                          <SelectItem value="CANCELADA">Cancelada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              </SectionBlock>

              <SectionBlock
                title="Observação"
                description="Registre apenas o contexto necessário para a operação e auditoria."
              >
                <div className="space-y-2">
                  <FieldLabel>Observação</FieldLabel>
                  <Textarea
                    value={values.observacao}
                    onChange={(event) => setValues((current) => ({ ...current, observacao: event.target.value }))}
                    className="min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30"
                    placeholder="Ex.: aluna interessada na turma de terça; responsável confirmou chegada 10 minutos antes."
                  />
                </div>
              </SectionBlock>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-8 py-5 sm:justify-end sm:space-x-3">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-slate-300 bg-white px-6 text-slate-700 hover:bg-slate-50"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="h-10 rounded-lg bg-brand-accent px-6 text-white hover:bg-brand-accent/90"
              disabled={submitting}
              data-testid="experimental-submit"
            >
              {submitting ? 'Salvando...' : mode === 'edit' ? 'Salvar alterações' : 'Agendar aula experimental'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}