'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useState } from 'react';

import { Download, Eye } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ListAttendanceQueryDTO } from '@/features/aulas/dtos';
import { AttendanceHistoryEventSheet } from '@/features/aulas/frequencia/components/AttendanceHistoryEventSheet';
import {
  getAttendanceEvent,
  listAttendanceHistoryTurma,
} from '@/features/aulas/frequencia/services/attendance-service';
import { downloadAttendancePdf } from '@/features/aulas/frequencia/utils/attendance-pdf';

type AttendanceHistoryTurmaDialogProps = {
  open: boolean;
  turmaId: string | null;
  filters: Partial<ListAttendanceQueryDTO>;
  onOpenChange: (_open: boolean) => void;
};

function formatOccurrenceDate(value: string) {
  return format(new Date(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

function summaryText(recorded: number, presentes: number, faltas: number) {
  return `${recorded} lançamentos • ${presentes} presentes • ${faltas} faltas`;
}

export function AttendanceHistoryTurmaDialog({
  open,
  turmaId,
  filters,
  onOpenChange,
}: AttendanceHistoryTurmaDialogProps) {
  const [loading, setLoading] = useState(false);
  const [downloadingEventId, setDownloadingEventId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof listAttendanceHistoryTurma>> | null>(null);

  useEffect(() => {
    if (!open || !turmaId) {
      setData(null);
      setSelectedEventId(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAttendanceHistoryTurma(turmaId, filters);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
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
    try {
      setDownloadingEventId(eventId);
      const details = await getAttendanceEvent(eventId);
      downloadAttendancePdf(details);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingEventId(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[96vw] max-w-5xl rounded-3xl p-0">
          <div className="flex max-h-[85vh] flex-col overflow-hidden bg-white">
            <DialogHeader className="border-b border-slate-200 px-8 py-6">
              <DialogTitle className="text-xl font-semibold text-slate-900">
                {data?.data.turma.label ?? 'Histórico da turma'}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-600">
                Veja as frequências já lançadas da turma e abra cada ocorrência para visualização ou PDF.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-8 py-6">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10 text-sm text-slate-500">
                  Carregando frequências lançadas...
                </div>
              ) : null}

              {error ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {data ? (
                <div className="space-y-5">
                  <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Ocorrências</div>
                      <div className="mt-1.5 text-sm font-semibold text-slate-900">{data.data.summary.totalOcorrencias}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Lançamentos</div>
                      <div className="mt-1.5 text-sm font-semibold text-slate-900">{data.data.summary.recorded}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Resumo</div>
                      <div className="mt-1.5 text-sm text-slate-700">
                        {summaryText(
                          data.data.summary.recorded,
                          data.data.summary.presentes,
                          data.data.summary.faltas,
                        )}
                      </div>
                    </div>
                  </div>

                  {data.data.items.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                      Nenhuma frequência lançada encontrada para esta turma no período.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200">
                      {data.data.items.map((item) => (
                        <div
                          key={item.eventId}
                          className="grid gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 md:grid-cols-[1.5fr_1fr_auto] md:items-center"
                        >
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{item.eventTitle}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatOccurrenceDate(item.date)}</div>
                            <div className="mt-2 text-xs text-slate-500">
                              {item.professores.map((professor) => professor.nome).join(', ') || 'Sem professor'}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="success">{item.summary.presentes} presentes</Badge>
                            <Badge variant="neutral">{item.summary.faltas} faltas</Badge>
                            {item.summary.atrasos > 0 ? (
                              <Badge variant="warning">{item.summary.atrasos} atrasos</Badge>
                            ) : null}
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => setSelectedEventId(item.eventId)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Visualizar
                            </Button>
                            <Button
                              type="button"
                              className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
                              onClick={() => void handleDownload(item.eventId)}
                              disabled={downloadingEventId === item.eventId}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {downloadingEventId === item.eventId ? 'Gerando...' : 'Baixar PDF'}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AttendanceHistoryEventSheet
        open={Boolean(selectedEventId)}
        eventId={selectedEventId}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedEventId(null);
        }}
      />
    </>
  );
}