'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

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
import type {
  AgendaOperationLogDTO,
  RebuildAgendaWindowResultDTO,
} from '@/features/aulas/dtos';
import { listAgendaOperationLogs } from '@/features/aulas/agenda/services/agenda-service';

type AgendaOperationLogSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rebuildResult: RebuildAgendaWindowResultDTO | null;
  syncing: boolean;
  onSyncWindow: () => void;
};

function getLevelVariant(level: AgendaOperationLogDTO['level']) {
  if (level === 'ERROR') return 'destructive';
  if (level === 'WARNING') return 'warning';
  return 'info';
}

export function AgendaOperationLogSheet({
  open,
  onOpenChange,
  rebuildResult,
  syncing,
  onSyncWindow,
}: AgendaOperationLogSheetProps) {
  const [logs, setLogs] = useState<AgendaOperationLogDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAgendaOperationLogs({ limit: 20 });
        if (!cancelled) setLogs(result.data.items);
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
  }, [open, rebuildResult]);

  const summary = rebuildResult?.data.summary ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Operação da agenda</SheetTitle>
          <SheetDescription>
            Sincronize a janela materializada e acompanhe logs recentes de conflitos e rebuild.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 py-6">
          {summary ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Última sincronização</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Criados</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{summary.created}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Atualizados</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{summary.updated}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Cancelados</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{summary.cancelled}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Removidos</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{summary.deleted}</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Janela: {format(new Date(summary.start), 'dd/MM/yyyy HH:mm')} -{' '}
                {format(new Date(summary.end), 'dd/MM/yyyy HH:mm')}
              </div>
            </div>
          ) : null}

          {loading ? <div className="text-sm text-slate-500">Carregando logs...</div> : null}
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getLevelVariant(log.level)}>{log.level}</Badge>
                  <Badge variant="outline">{log.action}</Badge>
                  <span className="text-xs text-slate-400">
                    {format(new Date(log.createdAt), "dd/MM/yyyy 'às' HH:mm")}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{log.message}</p>
                {log.entityType || log.entityId ? (
                  <div className="mt-2 text-xs text-slate-400">
                    {log.entityType ?? 'ENTIDADE'} {log.entityId ?? ''}
                  </div>
                ) : null}
              </div>
            ))}

            {!loading && !logs.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Nenhum log operacional encontrado.
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90" onClick={onSyncWindow} disabled={syncing}>
            {syncing ? 'Sincronizando...' : 'Sincronizar janela'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
