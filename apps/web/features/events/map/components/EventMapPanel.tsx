'use client';
import { useMemo, useState } from 'react';
import { formatDateTime } from '../../events-service';
import type { SchoolEventDTO } from '../../events-service';
import {
  createEventMap,
  deleteEventMap,
  listEventMaps,
  publishEventMap,
} from '../api/event-map-service';
import type { EventMapDTO } from '../api/event-map-service';

import { cn } from '@/lib/utils';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit3, Layers3, Plus, Rocket, Trash2 } from 'lucide-react';

import {
  canCreateEventMap,
  decideEventMapDeletion,
  MAX_EVENT_MAPS_PER_EVENT,
  resolveActivePublishedEventMap,
  resolvePublishedMapReplacement,
} from '@alusa/domain/events';

import { EVENT_TICKET_MODE_LABELS } from '@alusa/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { ConfirmDeleteDialog } from '@/components/dialogs/ConfirmDeleteDialog';

const eventMapQueryKeys = {
  maps: (eventId: string) => ['events', 'maps', eventId] as const,
};

const MAP_PANEL_STATUS_LABELS: Record<EventMapDTO['status'], string> = {
  DRAFT: 'Template',
  PUBLISHED: 'Ativo',
  ARCHIVED: 'Arquivado',
};

const EVENT_MAP_CARD_WIDTH_CLASS = 'shrink-0 w-96';

const MAP_ACTION_BUTTON_CLASS = 'w-full min-w-0 justify-center gap-1.5 px-2 text-sm';

function mapStatusVariant(status: EventMapDTO['status']) {
  if (status === 'PUBLISHED') return 'success' as const;
  if (status === 'ARCHIVED') return 'neutral' as const;
  return 'warning' as const;
}

function describeMapDeletion(map: EventMapDTO) {
  const decision = decideEventMapDeletion({
    status: map.status,
    versionsCount: map.versions.length,
    ordersCount: map.counts.orders ?? 0,
  });

  if (decision.action === 'ARCHIVE') {
    return {
      title: 'Remover mapa',
      description: decision.reason,
      confirmLabel: 'Remover',
      loadingLabel: 'Removendo...',
    };
  }

  if (decision.action === 'DEMOTE_TO_DRAFT') {
    return {
      title: 'Remover mapa ativo',
      description: decision.reason,
      confirmLabel: 'Confirmar',
      loadingLabel: 'Atualizando...',
    };
  }

  return {
    title: 'Excluir mapa',
    description: 'Deseja realmente excluir este template? A ação não pode ser desfeita.',
    confirmLabel: 'Excluir',
    loadingLabel: 'Excluindo...',
  };
}

function describeMapPublish(map: EventMapDTO, activePublishedMap: EventMapDTO | null) {
  if (!activePublishedMap || activePublishedMap.id === map.id) {
    return {
      title: 'Publicar template',
      description:
        'O mapa ficará ativo para venda pública e vendas internas. Revise setores, lotes e assentos antes de confirmar.',
      confirmLabel: 'Publicar',
      loadingLabel: 'Publicando...',
    };
  }

  const replacement = resolvePublishedMapReplacement(activePublishedMap.counts.orders ?? 0);
  if (replacement === 'ARCHIVE') {
    return {
      title: 'Publicar template',
      description: `O mapa ativo "${activePublishedMap.name}" será arquivado automaticamente e "${map.name}" passará a ser o mapa de venda.`,
      confirmLabel: 'Publicar e arquivar ativo',
      loadingLabel: 'Publicando...',
    };
  }

  return {
    title: 'Publicar template',
    description: `O mapa ativo "${activePublishedMap.name}" voltará para template e "${map.name}" passará a ser o mapa de venda.`,
    confirmLabel: 'Publicar e substituir ativo',
    loadingLabel: 'Publicando...',
  };
}

export function EventMapPanel({ event }: { event: SchoolEventDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mapToDelete, setMapToDelete] = useState<EventMapDTO | null>(null);
  const [mapToPublish, setMapToPublish] = useState<EventMapDTO | null>(null);
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

  const publishMutation = useMutation({
    mutationFn: (mapId: string) => publishEventMap(event.id, mapId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventMapQueryKeys.maps(event.id) });
      toast.success({
        title: 'Mapa publicado',
        description: 'O template agora é o mapa ativo de venda pública e interna.',
      });
      setMapToPublish(null);
    },
    onError: (error) => toast.error({ title: 'Não foi possível publicar', description: (error as Error).message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (mapId: string) => deleteEventMap(event.id, mapId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: eventMapQueryKeys.maps(event.id) });
      if (result.action === 'ARCHIVE') {
        toast.success({
          title: 'Mapa removido',
          description: 'O mapa saiu da listagem. Pedidos, tickets e auditoria foram preservados.',
        });
      } else if (result.action === 'DEMOTE_TO_DRAFT') {
        toast.success({
          title: 'Mapa removido da venda',
          description: 'O mapa voltou para template. Publique outro mapa para reativar a venda.',
        });
      } else {
        toast.success({ title: 'Mapa excluído', description: 'O template foi removido permanentemente.' });
      }
      setMapToDelete(null);
    },
    onError: (error) => toast.error({ title: 'Não foi possível concluir a ação', description: (error as Error).message }),
  });

  const ticketMode = event.ticketMode ?? (event.hasTickets ? 'SIMPLE' : 'NONE');
  const canUseMaps = ticketMode === 'NUMBERED_SEATS';
  const maps = mapsQuery.data ?? [];
  const activePublishedMap = useMemo(() => resolveActivePublishedEventMap(maps), [maps]);
  const canAddMap = canCreateEventMap(maps.length);
  const deleteDialog = mapToDelete ? describeMapDeletion(mapToDelete) : null;
  const publishDialog = mapToPublish ? describeMapPublish(mapToPublish, activePublishedMap) : null;

  return (
    <div className="space-y-5">
      {!canUseMaps ? (
        <Card className="rounded-xl border-slate-200 bg-slate-50 p-6">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-slate-950">Mapa disponível apenas para assentos numerados</h3>
            <p className="mt-2 text-sm text-slate-600">
              Para criar um mapa, edite o evento e altere o tipo de ingresso para Assentos numerados. Eventos com
              ingressos simples continuam usando apenas lotes e vendas por quantidade.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Modo atual: {EVENT_TICKET_MODE_LABELS[ticketMode]}
            </p>
          </div>
        </Card>
      ) : mapsQuery.isLoading ? (
        <div className="overflow-x-auto pb-2">
          <div className="flex w-max min-w-full flex-nowrap gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className={cn('h-52 animate-pulse rounded-xl bg-slate-100', EVENT_MAP_CARD_WIDTH_CLASS)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex w-max min-w-full flex-nowrap items-stretch gap-4">
          {canAddMap ? (
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className={cn(
                'flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-brand-accent/40 bg-brand-accent/5 p-6 text-center transition hover:border-brand-accent hover:bg-brand-accent/10 disabled:cursor-not-allowed disabled:opacity-60',
                EVENT_MAP_CARD_WIDTH_CLASS,
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
          ) : null}

          {maps.map((map) => (
            <Card
              key={map.id}
              className={cn(
                'group flex min-h-52 flex-col rounded-xl border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40',
                EVENT_MAP_CARD_WIDTH_CLASS,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-brand-accent" />
                    <h3 className="truncate text-base font-semibold text-slate-950">{map.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Atualizado em {formatDateTime(map.updatedAt)}</p>
                </div>
                <Badge variant={mapStatusVariant(map.status)}>{MAP_PANEL_STATUS_LABELS[map.status]}</Badge>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2.5 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="block text-xs text-slate-500">Setores</span>
                  <strong className="text-slate-950">{map.counts.sections}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="block text-xs text-slate-500">Assentos</span>
                  <strong className="text-slate-950">{map.counts.seats}</strong>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="block text-xs text-slate-500">Disp.</span>
                  <strong className="text-slate-950">{map.counts.availableSeats}</strong>
                </div>
              </div>

              <div className="mt-auto grid grid-cols-3 gap-2 pt-5">
                <Button asChild variant="outline" size="sm" className={cn('border-slate-200 bg-white text-slate-700', MAP_ACTION_BUTTON_CLASS)}>
                  <Link href={`/events/${event.id}/maps/${map.id}/editor`}>
                    <Edit3 className="h-3.5 w-3.5 shrink-0" />
                    Editar
                  </Link>
                </Button>

                {map.status === 'DRAFT' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent/5',
                      MAP_ACTION_BUTTON_CLASS,
                    )}
                    onClick={() => setMapToPublish(map)}
                    disabled={publishMutation.isPending}
                  >
                    <Rocket className="h-3.5 w-3.5 shrink-0" />
                    Publicar
                  </Button>
                ) : map.status === 'PUBLISHED' && map.publicUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('border-slate-200 bg-white text-slate-700', MAP_ACTION_BUTTON_CLASS)}
                    onClick={async () => {
                      if (!map.publicUrl) return;
                      const absoluteUrl = new URL(map.publicUrl, window.location.origin).toString();
                      await navigator.clipboard.writeText(absoluteUrl);
                      toast.success({
                        title: 'Link copiado',
                        description: 'O link público do mapa foi copiado para a área de transferência.',
                      });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                    Copiar link
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('border-rose-200 bg-white text-rose-700 hover:bg-rose-50', MAP_ACTION_BUTTON_CLASS)}
                  onClick={() => setMapToDelete(map)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  {map.status === 'PUBLISHED' ? 'Remover' : 'Excluir'}
                </Button>
              </div>
            </Card>
          ))}
          </div>
        </div>
      )}

      {canUseMaps && !mapsQuery.isLoading && maps.length >= MAX_EVENT_MAPS_PER_EVENT ? (
        <p className="text-sm text-slate-500">
          Limite de {MAX_EVENT_MAPS_PER_EVENT} mapas atingido. Remova ou exclua um mapa para criar outro.
        </p>
      ) : null}

      {mapToDelete && deleteDialog ? (
        <ConfirmDeleteDialog
          open={!!mapToDelete}
          onOpenChange={(open) => {
            if (!open) setMapToDelete(null);
          }}
          title={deleteDialog.title}
          description={deleteDialog.description}
          confirmLabel={deleteDialog.confirmLabel}
          cancelLabel="Cancelar"
          loadingLabel={deleteDialog.loadingLabel}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(mapToDelete.id);
          }}
        />
      ) : null}

      {mapToPublish && publishDialog ? (
        <ConfirmDeleteDialog
          open={!!mapToPublish}
          onOpenChange={(open) => {
            if (!open) setMapToPublish(null);
          }}
          title={publishDialog.title}
          description={publishDialog.description}
          confirmLabel={publishDialog.confirmLabel}
          cancelLabel="Cancelar"
          loadingLabel={publishDialog.loadingLabel}
          onConfirm={async () => {
            await publishMutation.mutateAsync(mapToPublish.id);
          }}
        />
      ) : null}
    </div>
  );
}
