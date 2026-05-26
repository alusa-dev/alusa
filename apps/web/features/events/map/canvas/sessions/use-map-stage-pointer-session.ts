'use client';

import {
  DEFAULT_SEAT_GRID_CONFIG,
  normalizeBoundsRect,
  suggestNextSeatGridConfig,
  type MapSelection,
  type TextMode,
} from '@alusa/domain';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import type Konva from 'konva';
import type { EventMapDTO } from '../../api/event-map-service';
import type { MapTool } from '../../store/event-map-editor-store';
import {
  getCreationBox,
  isCreationTool,
  isPlacementTool,
  type CreationDraft,
  type MarqueeDraft,
  type SeatGridDraft,
} from '../render/map-creation-draft';

export function useMapStagePointerSession({
  readOnly,
  tool,
  map,
  levelId,
  getPointerPoint,
  addObjectAt,
  addRowAt,
  setSelection,
  setIndividualSeatDragId,
  getMarqueeSelection,
  openNewTextEditor,
  handleSeatGroupResizeMove,
  endSeatGroupResize,
  creationDraft,
  setCreationDraft,
  marqueeDraft,
  setMarqueeDraft,
  seatGridDraft,
  setSeatGridDraft,
}: {
  readOnly: boolean;
  tool: MapTool;
  map: EventMapDTO | null;
  levelId: string | undefined;
  getPointerPoint: () => { x: number; y: number } | null;
  addObjectAt: (
    tool: MapTool,
    point: { x: number; y: number },
    size?: { width?: number; height?: number },
  ) => string | null;
  addRowAt: (point: { x: number; y: number }, quantity?: number) => void;
  setSelection: (selection: MapSelection | null) => void;
  setIndividualSeatDragId: Dispatch<SetStateAction<string | null>>;
  getMarqueeSelection: (box: { x: number; y: number; width: number; height: number }) => MapSelection;
  openNewTextEditor: (box: {
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    textMode: TextMode;
  }) => void;
  handleSeatGroupResizeMove: () => boolean;
  endSeatGroupResize: () => boolean;
  creationDraft: CreationDraft | null;
  setCreationDraft: Dispatch<SetStateAction<CreationDraft | null>>;
  marqueeDraft: MarqueeDraft | null;
  setMarqueeDraft: Dispatch<SetStateAction<MarqueeDraft | null>>;
  seatGridDraft: SeatGridDraft | null;
  setSeatGridDraft: Dispatch<SetStateAction<SeatGridDraft | null>>;
}) {
  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      if (readOnly) return;

      const placementActive = isPlacementTool(tool);
      const point = getPointerPoint();
      if (!point) return;

      if (placementActive) {
        if (tool === 'row') {
          addRowAt(point, 12);
          return;
        }

        if (tool === 'seat') {
          setCreationDraft(null);
          setSeatGridDraft({
            origin: point,
            config: suggestNextSeatGridConfig(map?.seats ?? [], levelId, DEFAULT_SEAT_GRID_CONFIG),
          });
          return;
        }

        if (isCreationTool(tool)) {
          setCreationDraft({ tool, start: point, current: point });
        }
        return;
      }

      if (event.target !== event.target.getStage()) return;

      if (tool === 'select') {
        setIndividualSeatDragId(null);
        setMarqueeDraft({ start: point, current: point });
        return;
      }

      setIndividualSeatDragId(null);
      setSelection(levelId ? [{ type: 'level', id: levelId }] : []);
    },
    [
      addRowAt,
      getPointerPoint,
      levelId,
      map?.seats,
      readOnly,
      setCreationDraft,
      setIndividualSeatDragId,
      setMarqueeDraft,
      setSeatGridDraft,
      setSelection,
      tool,
    ],
  );

  const handleStageMouseMove = useCallback(
    (_event: Konva.KonvaEventObject<MouseEvent>) => {
      if (handleSeatGroupResizeMove()) return;

      if (marqueeDraft && tool === 'select') {
        const point = getPointerPoint();
        if (!point) return;
        setMarqueeDraft((draft) => (draft ? { ...draft, current: point } : null));
        return;
      }

      if (!creationDraft) return;
      const point = getPointerPoint();
      if (!point) return;
      setCreationDraft((draft) => (draft ? { ...draft, current: point } : null));
    },
    [creationDraft, getPointerPoint, handleSeatGroupResizeMove, marqueeDraft, setCreationDraft, setMarqueeDraft, tool],
  );

  const handleStageMouseUp = useCallback(
    (_event: Konva.KonvaEventObject<MouseEvent>) => {
      if (endSeatGroupResize()) return;

      if (marqueeDraft && tool === 'select') {
        const point = getPointerPoint() ?? marqueeDraft.current;
        const box = normalizeBoundsRect(marqueeDraft.start, point);
        setMarqueeDraft(null);

        if (box.width >= 4 || box.height >= 4) {
          const items = getMarqueeSelection(box);
          setSelection(items.length > 0 ? items : levelId ? [{ type: 'level', id: levelId }] : []);
        } else {
          setSelection(levelId ? [{ type: 'level', id: levelId }] : []);
        }
        return;
      }

      if (!creationDraft) return;
      const point = getPointerPoint();
      if (!point) return;

      const draft = { ...creationDraft, current: point };
      const box = getCreationBox(draft);
      setCreationDraft(null);

      if (draft.tool === 'text') {
        if (box.width >= 6 && box.height >= 6) {
          openNewTextEditor({
            x: box.x,
            y: box.y,
            width: Math.max(20, box.width),
            height: Math.max(20, box.height),
            textMode: 'area',
          });
        } else if (box.width >= 6) {
          openNewTextEditor({
            x: box.x,
            y: box.y,
            width: Math.max(20, box.width),
            height: null,
            textMode: 'fixed-width',
          });
        } else {
          openNewTextEditor({
            x: draft.start.x,
            y: draft.start.y,
            width: null,
            height: null,
            textMode: 'auto',
          });
        }
        return;
      }

      if (box.width < 6 || box.height < 6) {
        addObjectAt(draft.tool, draft.start);
        return;
      }

      addObjectAt(draft.tool, { x: box.x, y: box.y }, { width: Math.max(20, box.width), height: Math.max(20, box.height) });
    },
    [
      addObjectAt,
      creationDraft,
      endSeatGroupResize,
      getMarqueeSelection,
      getPointerPoint,
      levelId,
      marqueeDraft,
      openNewTextEditor,
      setCreationDraft,
      setMarqueeDraft,
      setSelection,
      tool,
    ],
  );

  return {
    handleStageMouseDown,
    handleStageMouseMove,
    handleStageMouseUp,
  };
}
