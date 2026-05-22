import type { EventMapDTO } from '../api/event-map-service';
import { resolveSmartCorridorLayout } from './smart-corridor-layout';
import { getObjectBounds, getSeatBounds } from './selection-utils';
import { useEventMapEditorStore, type MapSelection } from '../store/event-map-editor-store';

export type EventMapE2EGeometry = {
  seats: Array<{
    id: string;
    label: string;
    rowLabel: string | null;
    seatNumber: string | null;
    x: number;
    y: number;
    size: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  corridors: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    data: Record<string, unknown>;
    coreRect: { x: number; y: number; width: number; height: number };
    clearanceRect: { x: number; y: number; width: number; height: number };
  }>;
  sections: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

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
      fitArtboardToView: () => void;
    };
  }
}

export function shouldExposeEventMapE2EBridge() {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_E2E === 'true';
}

function buildGeometry(): EventMapE2EGeometry {
  const map = useEventMapEditorStore.getState().map;
  if (!map) {
    return { seats: [], corridors: [], sections: [] };
  }

  const activeLevelId = useEventMapEditorStore.getState().activeLevelId ?? map.levels[0]?.id ?? null;

  const seats = map.seats
    .filter((seat) => seat.levelId === activeLevelId && seat.publicVisible)
    .map((seat) => {
      const bounds = getSeatBounds(seat);
      return {
        id: seat.id,
        label: seat.displayLabel,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        x: seat.x,
        y: seat.y,
        size: seat.size ?? 24,
        bounds,
      };
    });

  const corridors = map.objects
    .filter((object) => object.levelId === activeLevelId && object.type === 'CORRIDOR' && !object.hidden)
    .map((object) => {
      const layout = resolveSmartCorridorLayout(object);
      return {
        id: object.id,
        x: object.x,
        y: object.y,
        width: object.width ?? 0,
        height: object.height ?? 0,
        rotation: object.rotation ?? 0,
        data: object.data ?? {},
        coreRect: layout.coreRect,
        clearanceRect: layout.clearanceRect,
      };
    });

  const sections = map.objects
    .filter((object) => object.levelId === activeLevelId && object.type === 'SECTION' && object.sectionId && !object.hidden)
    .map((object) => {
      const bounds = getObjectBounds(object);
      return {
        id: object.sectionId!,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    });

  return { seats, corridors, sections };
}

export function registerEventMapE2EBridge() {
  if (!shouldExposeEventMapE2EBridge() || typeof window === 'undefined') return;

  window.__ALUSA_EVENT_MAP_EDITOR_E2E__ = {
    getState: () => {
      const state = useEventMapEditorStore.getState();
      return {
        map: state.map,
        selection: state.selection,
        tool: state.tool,
        activeLevelId: state.activeLevelId,
        pan: state.pan,
        zoom: state.zoom,
      };
    },
    getGeometry: buildGeometry,
    fitArtboardToView: () => {
      useEventMapEditorStore.getState().fitArtboardToView();
    },
  };
}

export function unregisterEventMapE2EBridge() {
  if (typeof window === 'undefined') return;
  delete window.__ALUSA_EVENT_MAP_EDITOR_E2E__;
}
