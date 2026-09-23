import { buildEventMapE2EGeometry, type EventMapE2EGeometry } from '@alusa/domain';
import type { EventMapDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import type { MapSelection } from '../store/event-map-editor-store';

export type { EventMapE2EGeometry };

export type EventMapE2EState = {
  map: EventMapDTO | null;
  selection: MapSelection;
  tool: string;
  activeLevelId: string | null;
  pan: { x: number; y: number };
  zoom: number;
};

declare global {
  interface Window {
    __ALUSA_EVENT_MAP_EDITOR_E2E__?: {
      getState: () => EventMapE2EState;
      getGeometry: () => EventMapE2EGeometry;
      getRenderGeometry: () => EventMapE2EGeometry;
      fitArtboardToView: () => void;
    };
  }
}

let currentRenderMapProvider: (() => EventMapDTO | null) | null = null;
export function setEventMapE2ERenderMapProvider(provider: (() => EventMapDTO | null) | null) {
  currentRenderMapProvider = provider;
}

export function shouldExposeEventMapE2EBridge() {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_E2E === 'true';
}

function getBridgeMap() {
  return currentRenderMapProvider?.() ?? useEventMapEditorStore.getState().map;
}

export function registerEventMapE2EBridge() {
  if (!shouldExposeEventMapE2EBridge() || typeof window === 'undefined') return;

  window.__ALUSA_EVENT_MAP_EDITOR_E2E__ = {
    getState: () => {
      const state = useEventMapEditorStore.getState();
      return {
        map: getBridgeMap(),
        selection: state.selection,
        tool: state.tool,
        activeLevelId: state.activeLevelId,
        pan: state.pan,
        zoom: state.zoom,
      };
    },
    getGeometry: () => {
      const state = useEventMapEditorStore.getState();
      const map = state.map;
      return map ? buildEventMapE2EGeometry(map, state.activeLevelId) : { seats: [], objects: [], sections: [] };
    },
    getRenderGeometry: () => {
      const state = useEventMapEditorStore.getState();
      const map = getBridgeMap();
      return map ? buildEventMapE2EGeometry(map, state.activeLevelId) : { seats: [], objects: [], sections: [] };
    },
    fitArtboardToView: () => {
      useEventMapEditorStore.getState().fitArtboardToView();
    },
  };
}

export function unregisterEventMapE2EBridge() {
  if (typeof window === 'undefined') return;
  currentRenderMapProvider = null;
  delete window.__ALUSA_EVENT_MAP_EDITOR_E2E__;
}
