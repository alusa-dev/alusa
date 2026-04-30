'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

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
import type { MakeupClassItemDTO } from '@/features/aulas/dtos';
import { getMakeupClass, updateMakeupClass } from '@/features/aulas/reposicoes/services/makeup-service';

type MakeupClassDetailsSheetProps = {
  open: boolean;
  makeupClassId: string | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
};

function getStatusVariant(status: MakeupClassItemDTO['status']) {
  if (status === 'REALIZADA') return 'success';
  if (status === 'CANCELADA') return 'neutral';
  return 'info';
}

export function MakeupClassDetailsSheet({
  open,
  makeupClassId,
  onOpenChange,
  onUpdated,
}: MakeupClassDetailsSheetProps) {
  const router = useRouter();
  const [item, setItem] = useState<MakeupClassItemDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<MakeupClassItemDTO['status'] | null>(null);

  useEffect(() => {
    if (!open || !makeupClassId) {
      setItem(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getMakeupClass(makeupClassId);
        if (!cancelled) setItem(result.data);
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
  }, [makeupClassId, open]);

  async function handleUpdateStatus(status: MakeupClassItemDTO['status']) {
    if (!makeupClassId) return;

    try {
      setUpdatingStatus(status);
      const result = await updateMakeupClass(makeupClassId, { status });
      setItem(result.data);
      onUpdated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingStatus(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Detalhes da reposição</SheetTitle>
          <SheetDescription>
            Origem e destino ficam vinculados para manter a trilha operacional consistente.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 py-6">
          {loading ? <div className="text-sm text-slate-500">Carregando reposição...</div> : null}
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {item ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusVariant(item.status)}>{item.status}</Badge>
                <Badge variant="outline">{item.scope}</Badge>
              </div>

              <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Aluno</div>
                  <div className="mt-1 text-sm text-slate-900">{item.aluno?.label ?? 'Reposição coletiva'}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Origem</div>
                  <div className="mt-1 text-sm text-slate-900">{item.turmaOrigem.label}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.eventoOrigem.title} • {format(new Date(item.eventoOrigem.startAt), "dd/MM/yyyy 'às' HH:mm")}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Destino</div>
                  <div className="mt-1 text-sm text-slate-900">{item.turmaDestino.label}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.eventoDestino.title} • {format(new Date(item.eventoDestino.startAt), "dd/MM/yyyy 'às' HH:mm")}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Criada em</div>
                  <div className="mt-1 text-sm text-slate-900">
                    {format(new Date(item.createdAt), "dd/MM/yyyy 'às' HH:mm")}
                  </div>
                </div>
              </div>

              {item.observacao ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Observação</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.observacao}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <SheetFooter>
          {item && item.status === 'AGENDADA' ? (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => handleUpdateStatus('REALIZADA')}
              disabled={updatingStatus !== null}
              data-testid="makeup-mark-realizada"
            >
              {updatingStatus === 'REALIZADA' ? 'Atualizando...' : 'Marcar como realizada'}
            </Button>
          ) : null}
          {item && item.status !== 'CANCELADA' ? (
            <Button
              variant="outline"
              className="rounded-xl text-rose-700"
              onClick={() => handleUpdateStatus('CANCELADA')}
              disabled={updatingStatus !== null}
              data-testid="makeup-cancel"
            >
              {updatingStatus === 'CANCELADA' ? 'Cancelando...' : 'Cancelar reposição'}
            </Button>
          ) : null}
          {item ? (
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => router.push(`/aulas/agenda?turmaId=${encodeURIComponent(item.turmaDestino.id)}`)}
            >
              Abrir agenda
            </Button>
          ) : null}
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
