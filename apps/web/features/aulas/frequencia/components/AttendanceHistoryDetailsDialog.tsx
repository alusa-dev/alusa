'use client';

import { ptBR } from 'date-fns/locale';
import { useEffect, useState } from 'react';

import { Download } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ListAttendanceQueryDTO } from '@/features/aulas/dtos';
import {
  getAttendanceEvent,
  listAttendanceHistoryTurma,
} from '@/features/aulas/frequencia/services/attendance-service';
import { downloadAttendancePdf } from '@/features/aulas/frequencia/utils/attendance-pdf';
import { formatInstantInAccountZone } from '@/lib/agenda-timezone';

type AttendanceHistoryDetailsDialogProps = {
  open: boolean;
  turmaId: string | null;
  filters: Partial<ListAttendanceQueryDTO>;
  onOpenChange: (_open: boolean) => void;
};

type AttendanceEventDetails = Awaited<ReturnType<typeof getAttendanceEvent>>;

function formatOccurrenceDate(value: string, timeZone: string) {
  return formatInstantInAccountZone(value, "dd/MM/yyyy 'às' HH:mm", timeZone, { locale: ptBR });
}

function getStatusLabel(status: string | null) {
  switch (status) {
    case 'PRESENTE':
      return 'Presente';
    case 'FALTA':
      return 'Falta';
    case 'FALTA_JUSTIFICADA':
      return 'Falta justificada';
    case 'ATRASO':
      return 'Atraso';
    case 'REPOSICAO':
      return 'Reposição';
    default:
      return 'Não lançado';
  }
}

function getStatusClassName(status: string | null) {
  switch (status) {
    case 'PRESENTE':
      return 'text-emerald-700';
    case 'FALTA':
      return 'text-rose-700';
    case 'FALTA_JUSTIFICADA':
      return 'text-amber-700';
    case 'ATRASO':
      return 'text-amber-700';
    case 'REPOSICAO':
      return 'text-violet-700';
    default:
      return 'text-slate-600';
  }
}

export function AttendanceHistoryDetailsDialog({
  open,
  turmaId,
  filters,
  onOpenChange,
}: AttendanceHistoryDetailsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [downloadingEventId, setDownloadingEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof listAttendanceHistoryTurma>> | null>(null);
  const [eventDetails, setEventDetails] = useState<Record<string, AttendanceEventDetails | null>>({});

  useEffect(() => {
    if (!open || !turmaId) {
      setData(null);
      setEventDetails({});
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        setData(null);
        setEventDetails({});

        const history = await listAttendanceHistoryTurma(turmaId, filters);
        const details = await Promise.all(
          history.data.items.map(async (item) => {
            try {
              return [item.eventId, await getAttendanceEvent(item.eventId)] as const;
            } catch {
              return [item.eventId, null] as const;
            }
          }),
        );

        if (cancelled) return;

        setData(history);
        setEventDetails(Object.fromEntries(details));
        if (details.some(([, detail]) => detail === null)) {
          setError('Algumas informações dos alunos não puderam ser carregadas. Tente novamente.');
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Não foi possível carregar o histórico da turma.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [filters, open, turmaId]);

  async function handleDownload(eventId: string) {
    const details = eventDetails[eventId];
    if (!details) return;

    try {
      setDownloadingEventId(eventId);
      downloadAttendancePdf(details);
    } catch (err) {
      setError((err as Error).message || 'Não foi possível preparar o PDF.');
    } finally {
      setDownloadingEventId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        className="flex w-[calc(100vw-2rem)] max-w-[760px] min-h-0 flex-col gap-0 overflow-hidden rounded-xl bg-white p-0 md:max-h-[calc(100dvh-4rem)]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DialogHeader className="border-b border-slate-200 bg-white px-6 py-5 text-left sm:px-8 sm:py-6">
            <DialogTitle className="pr-8 text-xl font-semibold text-slate-900">
              Detalhes da frequência
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-slate-600">
              {data?.data.turma.label ?? 'Turma'} • Consulte as frequências lançadas e a situação de cada aluno.
            </DialogDescription>
          </DialogHeader>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 sm:px-8 sm:py-7"
            style={{
              scrollbarWidth: 'thin',
              scrollbarGutter: 'stable',
            }}
          >
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-600">
                Carregando frequências e alunos...
              </div>
            ) : null}

            {error ? (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                {error}
              </div>
            ) : null}

            {data && !loading ? (
              data.data.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                  Nenhuma frequência lançada encontrada para esta turma no período.
                </div>
              ) : (
                <div className="space-y-7">
                  {data.data.items.map((item) => {
                    const details = eventDetails[item.eventId];
                    const event = details?.data.event;
                    const students = details?.data.students ?? [];

                    return (
                      <section key={item.eventId} className="rounded-xl bg-slate-50 p-4 sm:p-5">
                        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-slate-900">{item.eventTitle}</h3>
                            <p className="mt-1 text-sm text-slate-600">
                              {formatOccurrenceDate(item.date, data.data.timeZone)}
                              {' • '}
                              {item.professores.map((professor) => professor.nome).join(', ') || 'Sem professor'}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 shrink-0 rounded-lg bg-white"
                            onClick={() => void handleDownload(item.eventId)}
                            disabled={!details || downloadingEventId === item.eventId}
                          >
                            <Download className="h-4 w-4" />
                            {downloadingEventId === item.eventId ? 'Gerando PDF...' : 'Baixar PDF'}
                          </Button>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 sm:px-5">
                            <span>Aluno</span>
                            <span>Situação</span>
                          </div>
                          {event ? (
                            students.length > 0 ? (
                              students.map((student) => (
                                <div
                                  key={student.alunoId}
                                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:px-5"
                                >
                                  <span className="min-w-0 truncate text-sm text-slate-900">{student.nome}</span>
                                  <span className={`whitespace-nowrap text-sm font-medium ${getStatusClassName(student.status)}`}>
                                    {getStatusLabel(student.status)}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div className="px-4 py-5 text-sm text-slate-600 sm:px-5">Nenhum aluno encontrado.</div>
                            )
                          ) : (
                            <div className="px-4 py-5 text-sm text-slate-600 sm:px-5">
                              Não foi possível carregar os alunos desta ocorrência.
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )
            ) : null}
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-6 py-4 sm:px-8">
            <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
