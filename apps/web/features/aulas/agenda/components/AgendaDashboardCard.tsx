'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { listAgendaEvents } from '@/features/aulas/agenda/services/agenda-service';
import { getCalendarEventTemporalBadge } from '@/features/aulas/utils/calendar-event-state';

export function AgendaDashboardCard() {
  const router = useRouter();
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      startAt: string;
      endAt: string;
      status: 'AGENDADO' | 'REALIZADO' | 'CANCELADO';
      turma: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setHours(23, 59, 59, 999);

        const result = await listAgendaEvents({
          start: start.toISOString(),
          end: end.toISOString(),
        });

        if (cancelled) return;

        setItems(
          result.data.events.slice(0, 5).map((event) => ({
            id: event.id,
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            status: event.status,
            turma: event.turma?.label ?? null,
          })),
        );
        setError(null);
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
  }, []);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Agenda de hoje</h3>
          <p className="mt-1 text-xs text-gray-500">Resumo compacto da operação do dia.</p>
        </div>
        <Button variant="outline" className="rounded-xl" onClick={() => router.push('/aulas/agenda')}>
          Abrir Agenda
        </Button>
      </div>

      <div className="space-y-2 p-4">
        {loading ? (
          <div className="text-sm text-slate-500">Carregando agenda...</div>
        ) : error ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Não foi possível carregar a agenda de hoje.
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Nenhum evento programado para hoje.
          </div>
        ) : (
          items.map((item) => (
            (() => {
              const temporalBadge = getCalendarEventTemporalBadge(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => router.push('/aulas/agenda')}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span className="truncate">{item.turma ?? 'Sem turma'}</span>
                      {temporalBadge ? <span>{temporalBadge.label}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs font-medium text-slate-600">
                    {format(new Date(item.startAt), 'HH:mm')} - {format(new Date(item.endAt), 'HH:mm')}
                  </div>
                </button>
              );
            })()
          ))
        )}
      </div>
    </div>
  );
}
