'use client';
import { getSelectableItems, mergeEventMapWithLocalDraft, validateGroupCandidates } from '@alusa/domain';
import { registerEventMapE2EBridge, unregisterEventMapE2EBridge } from '../browser/event-map-e2e-bridge';
import { clearEventMapLocalDraft, readEventMapLocalDraft, writeEventMapLocalDraft } from '../browser/local-draft-storage';
import { listTicketLots } from '../../events-service';
import { getEventMap, publishEventMap, saveEventMapDraft } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import { FloatingMapToolbar } from './FloatingMapToolbar';
import { MapAreasPanel } from './MapAreasPanel';
import { MapBottomBar } from './MapBottomBar';
import { MapEditorHeader } from './MapEditorHeader';
import { MapEditorLoading } from './MapEditorLoading';
import { MapLayersPanel } from './MapLayersPanel';
import { MapPropertiesPanel } from './MapPropertiesPanel';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from '@/components/ui/toast';

const MapCanvas = dynamic(() => import('./MapCanvas').then((mod) => mod.MapCanvas), {
  ssr: false,
  loading: () => <div className="h-full min-h-0 flex-1 animate-pulse bg-slate-100" />,
});

const eventMapEditorQueryKeys = {
  map: (eventId: string, mapId: string) => ['events', 'map-editor', eventId, mapId] as const,
  lots: (eventId: string) => ['events', 'map-editor-lots', eventId] as const,
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function EventMapEditor({ eventId, mapId }: { eventId: string; mapId: string }) {
  const queryClient = useQueryClient();
  const mapQuery = useQuery({
    queryKey: eventMapEditorQueryKeys.map(eventId, mapId),
    queryFn: () => getEventMap(eventId, mapId),
    staleTime: 10_000,
  });
  const lotsQuery = useQuery({
    queryKey: eventMapEditorQueryKeys.lots(eventId),
    queryFn: () => listTicketLots(eventId),
    staleTime: 30_000,
  });

  const map = useEventMapEditorStore((state) => state.map);
  const loadMap = useEventMapEditorStore((state) => state.loadMap);
  const tool = useEventMapEditorStore((state) => state.tool);
  const setTool = useEventMapEditorStore((state) => state.setTool);
  const isDirty = useEventMapEditorStore((state) => state.isDirty);
  const markSaved = useEventMapEditorStore((state) => state.markSaved);
  const toPayload = useEventMapEditorStore((state) => state.toPayload);
  const spacePanPreviousToolRef = useRef<typeof tool | null>(null);
  const zoomKeyDownAtRef = useRef(0);
  const loadedMapIdRef = useRef<string | null>(null);

  const ZOOM_TAP_THRESHOLD_MS = 250;

  useEffect(() => {
    if (mapQuery.data && loadedMapIdRef.current !== mapQuery.data.id) {
      const localDraft = readEventMapLocalDraft(eventId, mapId);
      const restoredMap = localDraft ? mergeEventMapWithLocalDraft(mapQuery.data, localDraft.payload) : mapQuery.data;
      loadedMapIdRef.current = mapQuery.data.id;
      loadMap(restoredMap, { dirty: Boolean(localDraft) });
      if (localDraft) {
        toast.info({ title: 'Rascunho restaurado', description: 'Suas edições locais foram preservadas após recarregar a página.' });
      }
    }
  }, [eventId, loadMap, mapId, mapQuery.data]);

  useEffect(() => {
    if (!map || map.id !== mapId || map.status === 'ARCHIVED' || !isDirty) return;

    const timeout = window.setTimeout(() => {
      const payload = toPayload();
      if (payload) writeEventMapLocalDraft(eventId, mapId, payload);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [eventId, isDirty, map, mapId, toPayload]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      const state = useEventMapEditorStore.getState();
      if (!state.isDirty || !state.map || state.map.id !== mapId) return;
      const payload = state.toPayload();
      if (payload) writeEventMapLocalDraft(eventId, mapId, payload);
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [eventId, mapId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = toPayload();
      if (!payload) throw new Error('Mapa ainda não carregado.');
      return saveEventMapDraft(eventId, mapId, payload);
    },
    onSuccess: async (saved) => {
      clearEventMapLocalDraft(eventId, mapId);
      markSaved(saved);
      await queryClient.invalidateQueries({ queryKey: eventMapEditorQueryKeys.map(eventId, mapId) });
      toast.success({ title: 'Mapa salvo' });
    },
    onError: (error) => toast.error({ title: 'Não foi possível salvar', description: (error as Error).message }),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishEventMap(eventId, mapId),
    onSuccess: async (published) => {
      clearEventMapLocalDraft(eventId, mapId);
      markSaved(published);
      await queryClient.invalidateQueries({ queryKey: eventMapEditorQueryKeys.map(eventId, mapId) });
      toast.success({ title: 'Mapa publicado', description: 'O mapa está pronto para venda com assentos numerados.' });
    },
    onError: (error) => toast.error({ title: 'Não foi possível publicar', description: (error as Error).message }),
  });

  async function handlePublish() {
    if (map?.status !== 'ARCHIVED' && isDirty) {
      await saveMutation.mutateAsync();
    }
    await publishMutation.mutateAsync();
  }

  useEffect(() => {
    registerEventMapE2EBridge();
    return () => unregisterEventMapE2EBridge();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const store = useEventMapEditorStore.getState();

      if (key === 'z' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (!event.repeat) {
          store.beginTemporaryZoom();
          zoomKeyDownAtRef.current = Date.now();
        }
        return;
      }
      if (store.map?.status === 'ARCHIVED') return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!spacePanPreviousToolRef.current) {
          spacePanPreviousToolRef.current = store.tool;
          store.setTool('pan');
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'z' && event.shiftKey) {
        event.preventDefault();
        store.redo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        store.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'd') {
        event.preventDefault();
        store.duplicateSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'g') {
        event.preventDefault();
        if (!store.map) return;
        const validation = validateGroupCandidates(getSelectableItems(store.selection), store.map.objects);
        if (!validation.ok) {
          toast.warning({ title: 'Não foi possível agrupar', description: validation.reason });
          return;
        }
        store.groupSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'u') {
        event.preventDefault();
        store.ungroupSelection();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        store.deleteSelection();
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        store.nudgeSelection({ x: dx, y: dy });
        return;
      }
      if (key === 'v') store.setTool('select');
      if (key === 'h') store.setTool('pan');
      if (key === 't') store.setTool('text');
      if (key === 's') store.setTool('section');
      if (key === 'r') store.setTool('row');
      if (key === 'c') store.setTool('seat');
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        restoreSpacePanTool();
        event.preventDefault();
        return;
      }

      if (event.key.toLowerCase() !== 'z' || event.metaKey || event.ctrlKey) return;

      const store = useEventMapEditorStore.getState();
      if (store.zoomToolPinned && !store.temporaryZoomPreviousTool) return;

      const tap =
        Date.now() - zoomKeyDownAtRef.current <= ZOOM_TAP_THRESHOLD_MS && !store.zoomScrubbedThisHold;
      if (tap && store.temporaryZoomPreviousTool) {
        store.commitPermanentZoomTool();
      } else {
        store.restoreTemporaryZoomTool();
      }
      event.preventDefault();
    }

    function restoreSpacePanTool() {
      const previousTool = spacePanPreviousToolRef.current;
      if (!previousTool) return;
      spacePanPreviousToolRef.current = null;
      useEventMapEditorStore.getState().setTool(previousTool);
    }

    function restoreTransientTools() {
      restoreSpacePanTool();
      useEventMapEditorStore.getState().restoreTemporaryZoomTool();
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', restoreTransientTools);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', restoreTransientTools);
    };
  }, []);

  if (mapQuery.isLoading || !map) {
    return <MapEditorLoading />;
  }

  const readOnly = map.status === 'ARCHIVED';

  return (
    <main
      data-testid="event-map-editor"
      className="flex h-[100svh] min-h-0 flex-col overflow-hidden bg-slate-100 text-slate-950"
    >
      <MapEditorHeader
        map={map}
        isSaving={saveMutation.isPending}
        isPublishing={publishMutation.isPending}
        onSave={() => saveMutation.mutate()}
        onPublish={handlePublish}
      />
      <div className="min-h-0 flex-1">
        <section className="relative h-full min-w-0 overflow-hidden">
          <div className={`absolute left-4 top-24 z-20 flex max-h-[calc(100%-8rem)] w-72 flex-col gap-3${!['select', 'pan', 'zoom'].includes(tool) ? ' pointer-events-none' : ''}`}>
            <MapAreasPanel />
            <MapLayersPanel />
          </div>
          {!readOnly ? <FloatingMapToolbar activeTool={tool} onToolChange={setTool} /> : null}
          <MapCanvas readOnly={readOnly} />
          <MapBottomBar />
          <div className={!['select', 'pan', 'zoom'].includes(tool) ? 'pointer-events-none' : ''}>
            <MapPropertiesPanel lots={lotsQuery.data ?? []} status={map.status} />
          </div>
        </section>
      </div>
    </main>
  );
}
