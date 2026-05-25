'use client';
import { formatDateTime } from '../../events-service';
import type { SchoolEventDTO } from '../../events-service';
import { createEventMap, deleteEventMap, duplicateEventMap, listEventMaps } from '../api/event-map-service';
import type { EventMapDTO } from '../api/event-map-service';

import { cn } from '@/lib/utils';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit3, Layers3, Map, Plus, Trash2 } from 'lucide-react';

import {
  EVENT_MAP_STATUS_LABELS,
  EVENT_TICKET_MODE_LABELS,
} from '@alusa/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

const eventMapQueryKeys = {
  maps: (eventId: string) => ['events', 'maps', eventId] as const,
};

function mapStatusVariant(status: EventMapDTO['status']) {
  if (status === 'PUBLISHED') return 'success' as const;
  if (status === 'ARCHIVED') return 'neutral' as const;
  return 'warning' as const;
}

function modeText(event: SchoolEventDTO) {
  return EVENT_TICKET_MODE_LABELS[event.ticketMode ?? (event.hasTickets ? 'SIMPLE' : 'NONE')];
}

export function EventMapPanel({ event }: { event: SchoolEventDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const mapsQuery = useQuery({
    queryKey: eventMapQueryKeys.maps(event.id),
    queryFn: () => listEventMaps(event.id),
    staleTime: 20_000,
  });

  const createMutation = useMutation({
    mutationFn: () => createEventMap(event.id, { name: 'Mapa principal' }),
    onSuccess: async (map) => {
      await queryClient.invalidateQueries({ queryKey: eventMapQueryKeys.maps(event.id) });
      router.push(`/events/${event.id}/maps/${map.id}/editor`);
    },
    onError: (error) => toast.error({ title: 'Não foi possível criar o mapa', description: (error as Error).message }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (mapId: string) => duplicateEventMap(event.id, mapId),
    onSuccess: async (map) => {
      await queryClient.invalidateQueries({ queryKey: eventMapQueryKeys.maps(event.id) });
      toast.success({ title: 'Mapa duplicado', description: 'O novo rascunho foi criado a partir do template.' });
      router.push(`/events/${event.id}/maps/${map.id}/editor`);
    },
    onError: (error) => toast.error({ title: 'Não foi possível duplicar', description: (error as Error).message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (mapId: string) => deleteEventMap(event.id, mapId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventMapQueryKeys.maps(event.id) });
      toast.success({ title: 'Mapa excluído' });
    },
    onError: (error) => toast.error({ title: 'Não foi possível excluir', description: (error as Error).message }),
  });

  const ticketMode = event.ticketMode ?? (event.hasTickets ? 'SIMPLE' : 'NONE');
  const canCreateMap = ticketMode === 'NUMBERED_SEATS';
  const maps = mapsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-brand-accent" />
            <h2 className="text-sm font-semibold text-slate-950">Mapa do evento</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            O mapa organiza setores, fileiras e assentos. O preço continua vindo dos lotes vinculados aos setores.
          </p>
        </div>
        <Badge variant={canCreateMap ? 'success' : 'neutral'}>{modeText(event)}</Badge>
      </div>

      {!canCreateMap ? (
        <Card className="rounded-xl border-slate-200 bg-slate-50 p-6">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-slate-950">Mapa disponível apenas para assentos numerados</h3>
            <p className="mt-2 text-sm text-slate-600">
              Para criar um mapa, edite o evento e altere o tipo de ingresso para Assentos numerados. Eventos com
              ingressos simples continuam usando apenas lotes e vendas por quantidade.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className={cn(
              'flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-brand-accent/40 bg-brand-accent/5 p-6 text-center transition hover:border-brand-accent hover:bg-brand-accent/10 disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-accent text-white shadow-sm">
              <Plus className="h-6 w-6" />
            </span>
            <span className="mt-4 text-base font-semibold text-slate-950">
              {createMutation.isPending ? 'Criando mapa...' : 'Criar Mapa'}
            </span>
            <span className="mt-2 max-w-64 text-sm text-slate-500">
              Inicia um rascunho com prancheta, toolbar flutuante e editor dedicado.
            </span>
          </button>

          {maps.map((map) => (
            <Card key={map.id} className="group flex min-h-52 flex-col rounded-xl border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-brand-accent" />
                    <h3 className="truncate text-base font-semibold text-slate-950">{map.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Atualizado em {formatDateTime(map.updatedAt)}</p>
                </div>
                <Badge variant={mapStatusVariant(map.status)}>{EVENT_MAP_STATUS_LABELS[map.status]}</Badge>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-500">Setores</span>
                  <strong className="text-slate-950">{map.counts.sections}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-500">Assentos</span>
                  <strong className="text-slate-950">{map.counts.seats}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-500">Disp.</span>
                  <strong className="text-slate-950">{map.counts.availableSeats}</strong>
                </div>
              </div>

              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <Button asChild variant="outline" size="sm" className="border-slate-200 bg-white text-slate-700">
                  <Link href={`/events/${event.id}/maps/${map.id}/editor`}>
                    <Edit3 className="h-3.5 w-3.5" />
                    Abrir
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-200 bg-white text-slate-700"
                  onClick={() => duplicateMutation.mutate(map.id)}
                  disabled={duplicateMutation.isPending}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Usar como template
                </Button>
                {map.status === 'DRAFT' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                    onClick={() => {
                      if (window.confirm('Excluir este rascunho de mapa?')) deleteMutation.mutate(map.id);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {mapsQuery.isLoading && canCreateMap ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-52 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
