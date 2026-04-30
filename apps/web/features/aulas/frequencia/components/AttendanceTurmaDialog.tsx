'use client';

import { addDays, format, startOfDay, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';

import { Calendar, ChevronLeft, ChevronRight } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { AttendanceStatusDTO } from '@/features/aulas/dtos';
import {
  evaluateAttendanceLaunchPolicy,
  getAttendanceLaunchPolicyMessage,
  isAttendanceEventOnSelectedDay,
} from '@/features/aulas/utils/attendance-launch';
import {
  getAttendanceEvent,
  getAttendanceTurmaWorkspace,
  saveAttendanceEvent,
} from '@/features/aulas/frequencia/services/attendance-service';
import { ATTENDANCE_STATUS_OPTIONS } from '@/features/aulas/types';
import { cn } from '@/lib/utils';

type AttendanceTurmaDialogProps = {
  open: boolean;
  turmaId: string | null;
  initialDate: string;
  onOpenChange: (_open: boolean) => void;
  onSaved: () => void;
};

type DraftRecord = {
  alunoId: string;
  matriculaId: string | null;
  nome: string;
  source: 'TURMA' | 'REPOSICAO';
  status: AttendanceStatusDTO | null;
  observacao: string;
};

function serializeDraftRecords(records: DraftRecord[]) {
  return JSON.stringify(
    [...records]
      .map((record) => ({
        alunoId: record.alunoId,
        status: record.status,
        observacao: record.observacao.trim(),
      }))
      .sort((first, second) => first.alunoId.localeCompare(second.alunoId, 'pt-BR')),
  );
}

function formatFullDate(value: string) {
  return format(new Date(value), "EEEE, dd 'de' MMMM", { locale: ptBR });
}

function formatTimeWindow(startAt: string, endAt: string) {
  return `${format(new Date(startAt), 'HH:mm')} - ${format(new Date(endAt), 'HH:mm')}`;
}

function toStateLabel(state: string) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 'Em andamento';
    case 'PENDENTE':
      return 'Pendente';
    case 'REALIZADA':
      return 'Realizada';
    case 'CANCELADA':
      return 'Cancelada';
    case 'FUTURA':
      return 'Futura';
    default:
      return 'Sem aula';
  }
}

function getStateBadgeVariant(state: string) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 'info';
    case 'PENDENTE':
      return 'warning';
    case 'REALIZADA':
      return 'success';
    case 'CANCELADA':
      return 'neutral';
    case 'FUTURA':
      return 'default';
    default:
      return 'neutral';
  }
}

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>{children}</section>;
}

function MetaStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function AttendanceTurmaDialog({
  open,
  turmaId,
  initialDate,
  onOpenChange,
  onSaved,
}: AttendanceTurmaDialogProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Awaited<ReturnType<typeof getAttendanceTurmaWorkspace>> | null>(
    null,
  );
  const [records, setRecords] = useState<DraftRecord[]>([]);
  const [savedRecordsSignature, setSavedRecordsSignature] = useState('[]');

  useEffect(() => {
    if (open) {
      setSelectedDate(initialDate);
    }
  }, [initialDate, open]);

  useEffect(() => {
    if (!open || !turmaId) {
      setWorkspace(null);
      setSelectedOccurrenceId(null);
      setRecords([]);
      setSavedRecordsSignature('[]');
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingWorkspace(true);
        setError(null);
        const result = await getAttendanceTurmaWorkspace(turmaId, {
          date: selectedDate,
        });
        if (cancelled) return;

        setWorkspace(result);
        setSelectedOccurrenceId((current) => {
          if (current && result.data.occurrences.some((item) => item.eventId === current)) {
            return current;
          }

          return result.data.selectedOccurrenceId;
        });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingWorkspace(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, selectedDate, turmaId]);

  useEffect(() => {
    if (!open || !selectedOccurrenceId) {
      setRecords([]);
      setSavedRecordsSignature('[]');
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoadingEvent(true);
        setError(null);
        const result = await getAttendanceEvent(selectedOccurrenceId);
        if (cancelled) return;

        const nextRecords = result.data.students.map((student) => ({
          alunoId: student.alunoId,
          matriculaId: student.matriculaId,
          nome: student.nome,
          source: student.source,
          status: student.status,
          observacao: student.observacao ?? '',
        }));

        setRecords(nextRecords);
        setSavedRecordsSignature(serializeDraftRecords(nextRecords));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingEvent(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, selectedOccurrenceId]);

  const selectedOccurrence = useMemo(
    () => workspace?.data.occurrences.find((item) => item.eventId === selectedOccurrenceId) ?? null,
    [selectedOccurrenceId, workspace?.data.occurrences],
  );
  const showOccurrenceSelector = (workspace?.data.occurrences.length ?? 0) > 1;
  const currentRecordsSignature = useMemo(() => serializeDraftRecords(records), [records]);
  const isAlreadyLaunched = selectedOccurrence?.launchState === 'REALIZADA';
  const isDirty = currentRecordsSignature !== savedRecordsSignature;
  const filledRecords = records.filter((record) => record.status).length;
  const presentesCount = records.filter((record) => record.status === 'PRESENTE').length;
  const faltasCount = records.filter((record) => record.status === 'FALTA').length;

  const launchPolicy = selectedOccurrence
    ? evaluateAttendanceLaunchPolicy({
        startAt: selectedOccurrence.startAt,
        status: selectedOccurrence.status,
      })
    : null;
  const canSave = Boolean(launchPolicy?.allowed);
  const isUpcomingToday = Boolean(
    selectedOccurrence &&
      new Date(selectedOccurrence.startAt).getTime() > Date.now() &&
      isAttendanceEventOnSelectedDay({ startAt: selectedOccurrence.startAt }),
  );

  async function handleSave() {
    if (!selectedOccurrenceId || !canSave) return;

    try {
      setSaving(true);
      setError(null);
      await saveAttendanceEvent(selectedOccurrenceId, {
        items: records
          .filter((record) => record.status)
          .map((record) => ({
            alunoId: record.alunoId,
            matriculaId: record.matriculaId,
            status: record.status as AttendanceStatusDTO,
            observacao: record.observacao.trim() || null,
          })),
      });

      const [nextWorkspace, nextEvent] = await Promise.all([
        turmaId
          ? getAttendanceTurmaWorkspace(turmaId, {
              date: selectedDate,
            })
          : Promise.resolve(null),
        getAttendanceEvent(selectedOccurrenceId),
      ]);

      if (nextWorkspace) setWorkspace(nextWorkspace);
      const nextRecords = nextEvent.data.students.map((student) => ({
        alunoId: student.alunoId,
        matriculaId: student.matriculaId,
        nome: student.nome,
        source: student.source,
        status: student.status,
        observacao: student.observacao ?? '',
      }));
      setRecords(nextRecords);
      setSavedRecordsSignature(serializeDraftRecords(nextRecords));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function getSubmitLabel() {
    if (saving) {
      return isAlreadyLaunched ? 'Atualizando frequência...' : 'Lançando frequência...';
    }

    if (isAlreadyLaunched && isDirty) {
      return 'Atualizar frequência';
    }

    if (isAlreadyLaunched) {
      return 'Frequência lançada';
    }

    return 'Lançar frequência';
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-6xl gap-0 overflow-hidden rounded-3xl p-0">
        <div className="flex max-h-[88vh] flex-col bg-slate-50/80">
          <DialogHeader className="border-b border-slate-200 bg-white px-8 py-6">
            <DialogTitle className="text-xl font-semibold text-slate-900">
              {workspace?.data.turma.label ?? 'Frequência da turma'}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              Escolha o dia da chamada e registre a frequência da turma.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-8 py-6">
            <div className="space-y-6">
              <SectionCard className="bg-gradient-to-br from-white to-slate-50/80">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
                      Dia da chamada
                    </div>
                    <div className="mt-1.5 text-base font-semibold capitalize text-slate-900">
                      {formatFullDate(selectedDate)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl"
                      onClick={() => setSelectedDate(startOfDay(subDays(new Date(selectedDate), 1)).toISOString())}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-xl px-4 text-sm font-medium text-slate-700"
                      onClick={() => setSelectedDate(startOfDay(new Date()).toISOString())}
                    >
                      Hoje
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl"
                      onClick={() => setSelectedDate(startOfDay(addDays(new Date(selectedDate), 1)).toISOString())}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </SectionCard>

              {loadingWorkspace ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-sm text-slate-500 shadow-sm">
                  Carregando programação da turma...
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {!loadingWorkspace && workspace && workspace.data.occurrences.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div className="mt-4 text-lg font-semibold text-slate-900">Sem aula nesta data</div>
                  <p className="mt-2 text-sm text-slate-500">
                    Use a navegação acima para voltar ou avançar até uma ocorrência da turma.
                  </p>
                </div>
              ) : null}

              {workspace && showOccurrenceSelector ? (
                <SectionCard>
                  <div className="mb-4">
                    <div className="text-sm font-semibold text-slate-900">Escolha o horário da chamada</div>
                    <p className="mt-1 text-xs text-slate-500">
                      Selecione a aula correta para lançar a frequência.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {workspace.data.occurrences.map((occurrence) => (
                      <button
                        key={occurrence.eventId}
                        type="button"
                        onClick={() => setSelectedOccurrenceId(occurrence.eventId)}
                        className={cn(
                          'rounded-2xl border px-4 py-3 text-left transition-colors',
                          selectedOccurrenceId === occurrence.eventId
                            ? 'border-brand-accent bg-brand-accent/8 shadow-[0_10px_25px_rgba(91,47,167,0.10)]'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {formatTimeWindow(occurrence.startAt, occurrence.endAt)}
                          </span>
                          <Badge variant={getStateBadgeVariant(occurrence.launchState)}>
                            {toStateLabel(occurrence.launchState)}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </SectionCard>
              ) : null}

              {selectedOccurrence ? (
                <>
                  <SectionCard className="bg-slate-50/70">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">{selectedOccurrence.title}</div>
                          <Badge variant={getStateBadgeVariant(selectedOccurrence.launchState)}>
                            {toStateLabel(selectedOccurrence.launchState)}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatFullDate(selectedOccurrence.startAt)} •{' '}
                          {formatTimeWindow(selectedOccurrence.startAt, selectedOccurrence.endAt)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>
                            Sala: {selectedOccurrence.sala?.label ?? workspace?.data.sala?.label ?? 'Sem sala'}
                          </span>
                          <span>
                            Professores:{' '}
                            {selectedOccurrence.professores.map((professor) => professor.nome).join(', ') || 'Sem professor'}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MetaStat label="Lançados" value={filledRecords} />
                        <MetaStat label="Presentes" value={presentesCount} />
                        <MetaStat label="Faltas" value={faltasCount} />
                        <MetaStat
                          label="Pendentes"
                          value={Math.max(records.length - filledRecords, 0)}
                        />
                      </div>
                    </div>
                  </SectionCard>

                  {!canSave && launchPolicy ? (
                    <div
                      className={cn(
                        'rounded-2xl px-4 py-3 text-sm',
                        launchPolicy.reason === 'WINDOW_EXPIRED'
                          ? 'border border-rose-200 bg-rose-50 text-rose-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700',
                      )}
                    >
                      {getAttendanceLaunchPolicyMessage(launchPolicy.reason)}
                    </div>
                  ) : null}

                  {canSave && isUpcomingToday ? (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                      A aula ainda não começou, mas a frequência já pode ser lançada hoje para essa turma.
                    </div>
                  ) : null}

                  <SectionCard>
                    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Lista de alunos</div>
                        <p className="mt-1 text-xs text-slate-500">
                          Marque a presença dos alunos e conclua a chamada da turma.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() =>
                          setRecords((current) =>
                            current.map((record) => ({
                              ...record,
                              status: 'PRESENTE',
                            })),
                          )
                        }
                        disabled={!canSave}
                      >
                        Marcar todos presentes
                      </Button>
                    </div>

                    <div className="mt-5 space-y-4">
                      {loadingEvent ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                          Carregando alunos da ocorrência...
                        </div>
                      ) : records.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                          Não há alunos elegíveis nesta ocorrência.
                        </div>
                      ) : (
                        records.map((record) => (
                          <div key={record.alunoId} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold text-slate-900">{record.nome}</div>
                                  {record.source === 'REPOSICAO' ? <Badge variant="info">Reposição</Badge> : null}
                                  {record.status ? (
                                    <Badge variant={record.status === 'PRESENTE' ? 'success' : record.status === 'FALTA' ? 'neutral' : 'warning'}>
                                      {ATTENDANCE_STATUS_OPTIONS.find((option) => option.value === record.status)?.label ?? record.status}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {record.status ? 'Status selecionado para esta chamada.' : 'Selecione a situação do aluno nesta ocorrência.'}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      setRecords((current) =>
                                        current.map((item) =>
                                          item.alunoId === record.alunoId
                                            ? { ...item, status: option.value }
                                            : item,
                                        ),
                                      )
                                    }
                                    className={cn(
                                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                                      record.status === option.value
                                        ? 'border-brand-accent bg-brand-accent text-white'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                                      !canSave && 'pointer-events-none opacity-60',
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <Textarea
                              value={record.observacao}
                              onChange={(event) =>
                                setRecords((current) =>
                                  current.map((item) =>
                                    item.alunoId === record.alunoId
                                      ? { ...item, observacao: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              className="mt-3 min-h-[84px] rounded-2xl border-slate-200 bg-white"
                              placeholder="Observação opcional"
                              disabled={!canSave}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </SectionCard>
                </>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-8 py-5 sm:justify-between sm:space-x-0">
            <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              className={cn(
                'rounded-xl text-white',
                isAlreadyLaunched && !isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-600'
                  : 'bg-brand-accent hover:bg-brand-accent/90',
              )}
              onClick={() => void handleSave()}
              disabled={saving || !canSave || !selectedOccurrenceId || (isAlreadyLaunched && !isDirty)}
            >
              {getSubmitLabel()}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
