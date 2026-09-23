'use client';

import { useEventMapEditorStore } from '../../store/event-map-editor-store';

export function useMapCanvasStore() {
  const map = useEventMapEditorStore((state) => state.map);
  const tool = useEventMapEditorStore((state) => state.tool);
  const selection = useEventMapEditorStore((state) => state.selection);
  const activeLevelId = useEventMapEditorStore((state) => state.activeLevelId);
  const zoom = useEventMapEditorStore((state) => state.zoom);
  const pan = useEventMapEditorStore((state) => state.pan);
  const setPan = useEventMapEditorStore((state) => state.setPan);
  const setZoom = useEventMapEditorStore((state) => state.setZoom);
  const setSelection = useEventMapEditorStore((state) => state.setSelection);
  const addObjectAt = useEventMapEditorStore((state) => state.addObjectAt);
  const addRowAt = useEventMapEditorStore((state) => state.addRowAt);
  const addSeatBlockAt = useEventMapEditorStore((state) => state.addSeatBlockAt);
  const updateObject = useEventMapEditorStore((state) => state.updateObject);
  const updateObjects = useEventMapEditorStore((state) => state.updateObjects);
  const updateMapItems = useEventMapEditorStore((state) => state.updateMapItems);
  const deleteObject = useEventMapEditorStore((state) => state.deleteObject);
  const updateSeat = useEventMapEditorStore((state) => state.updateSeat);
  const setInlineTextEditorActive = useEventMapEditorStore((state) => state.setInlineTextEditorActive);
  const setViewportSize = useEventMapEditorStore((state) => state.setViewportSize);

  return {
    map,
    tool,
    selection,
    activeLevelId,
    zoom,
    pan,
    setPan,
    setZoom,
    setSelection,
    addObjectAt,
    addRowAt,
    addSeatBlockAt,
    updateObject,
    updateObjects,
    updateMapItems,
    deleteObject,
    updateSeat,
    setInlineTextEditorActive,
    setViewportSize,
  };
}
