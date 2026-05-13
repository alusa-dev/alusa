'use client';

import { ptBR } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { getAttendanceEvent } from '@/features/aulas/frequencia/services/attendance-service';
import { downloadAttendancePdf } from '@/features/aulas/frequencia/utils/attendance-pdf';
import { DEFAULT_ACCOUNT_TIMEZONE, formatInstantInAccountZone, normalizeAccountTimeZoneClient } from '@/lib/agenda-timezone';

type AttendanceHistoryEventSheetProps = {
  open: boolean;
  eventId: string | null;
  onOpenChange: (_open: boolean) => void;
};

function getStatusVariant(status: string | null) {
  if (status === 'PRESENTE') return 'success';
  if (status === 'REPOSICAO') return 'info';
  if (status === 'ATRASO') return 'warning';
  return 'neutral';
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

export function AttendanceHistoryEventSheet({
  open,
  eventId,
  onOpenChange,
}: AttendanceHistoryEventSheetProps) {
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof getAttendanceEvent>> | null>(null);

  useEffect(() => {
    if (!open || !eventId) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getAttendanceEvent(eventId);
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
  }, [eventId, open]);

  const students = data?.data.students ?? [];
  const event = data?.data.event;
  const summary = data?.data.summary;
  const accountTz = normalizeAccountTimeZoneClient(data?.timeZone ?? DEFAULT_ACCOUNT_TIMEZONE);
  const occurrenceLabel = useMemo(() => {
    if (!event) return '';

    return formatInstantInAccountZone(event.startAt, "dd 'de' MMMM 'às' HH:mm", accountTz, { locale: ptBR });
  }, [event, accountTz]);

  async function handleDownload() {
    if (!data) return;

    try {
      setDownloading(true);
      downloadAttendancePdf(data);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{event?.title ?? 'Frequência lançada'}</SheetTitle>
          <SheetDescription>
            {event ? `${event.turma?.label ?? 'Sem turma'} • ${occurrenceLabel}` : 'Visualize a ocorrência lançada.'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-6 py-6">
          {loading ? <div className="text-sm text-slate-500">Carregando frequência...</div> : null}

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {event && summary ? (
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Professor(es)</div>
                <div className="mt-1.5 text-sm text-slate-700">
                  {event.professores.map((professor) => professor.nome).join(', ') || 'Sem professor'}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Resumo</div>
                <div className="mt-1.5 text-sm text-slate-700">
                  {summary.recorded} lançamentos • {summary.presente} presentes • {summary.falta} faltas
                </div>
              </div>
            </div>
          ) : null}

          {students.map((student) => (
            <div key={student.alunoId} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{student.nome}</div>
                    {student.source === 'REPOSICAO' ? <Badge variant="info">Reposição</Badge> : null}
                  </div>
                  {student.observacao ? (
                    <div className="mt-2 text-sm text-slate-500">{student.observacao}</div>
                  ) : null}
                </div>
                <Badge variant={getStatusVariant(student.status)}>{getStatusLabel(student.status)}</Badge>
              </div>
            </div>
          ))}
        </div>

        <SheetFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
            onClick={() => void handleDownload()}
            disabled={!data || downloading}
          >
            {downloading ? 'Preparando PDF...' : 'Baixar PDF'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}