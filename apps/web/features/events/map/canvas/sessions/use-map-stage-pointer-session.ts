'use client';

import { normalizeBoundsRect, type MapSelection, type SeatBlockConfig, type TextMode } from '@alusa/domain';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import type Konva from 'konva';
import type { EventMapDTO } from '../../api/event-map-service';
import type { MapTool } from '../../store/event-map-editor-store';
import { getCreationBox, getSeatBlockConfigForBounds, isCreationTool, isPlacementTool, type CreationDraft, type MarqueeDraft } from '../render/map-creation-draft';

export function useMapStagePointerSession({
  readOnly,
  tool,
  map,
  levelId,
  getPointerPoint,
  addObjectAt,
  addRowAt,
  addSeatBlockAt,
  seatBlockDefaults,
  setSelection,
  setIndividualSeatDragId,
  getMarqueeSelection,
  openNewTextEditor,
  creationDraft,
  setCreationDraft,
  marqueeDraft,
  setMarqueeDraft,
}: {
  readOnly: boolean;
  tool: MapTool;
  map: EventMapDTO | null;
  levelId: string | undefined;
  zoom: number;
  getPointerPoint: () => { x: number; y: number } | null;
  addObjectAt: (tool: MapTool, point: { x: number; y: number }, size?: { width?: number; height?: number }) => string | null;
  addRowAt: (point: { x: number; y: number }, quantity?: number) => void;
  addSeatBlockAt: (point: { x: number; y: number }, config: Partial<SeatBlockConfig>) => void;
  seatBlockDefaults?: Pick<SeatBlockConfig, 'seatSize' | 'horizontalSpacing' | 'verticalSpacing'>;
  setSelection: (selection: MapSelection | null) => void;
  setIndividualSeatDragId: Dispatch<SetStateAction<string | null>>;
  getMarqueeSelection: (box: { x: number; y: number; width: number; height: number }) => MapSelection;
  openNewTextEditor: (box: { x: number; y: number; width: number | null; height: number | null; textMode: TextMode }) => void;
  creationDraft: CreationDraft | null;
  setCreationDraft: Dispatch<SetStateAction<CreationDraft | null>>;
  marqueeDraft: MarqueeDraft | null;
  setMarqueeDraft: Dispatch<SetStateAction<MarqueeDraft | null>>;
}) {
  const handleStageMouseDown = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    if (readOnly) return;
    const point = getPointerPoint();
    if (!point) return;

    if (isPlacementTool(tool)) {
      if (tool === 'row') {
        addRowAt(point, 12);
        return;
      }
      if (tool === 'seat') {
        setCreationDraft({ tool, start: point, current: point });
        return;
      }
      if (isCreationTool(tool)) setCreationDraft({ tool, start: point, current: point });
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
  }, [addRowAt, getPointerPoint, levelId, readOnly, setCreationDraft, setIndividualSeatDragId, setMarqueeDraft, setSelection, tool]);

  const handleStageMouseMove = useCallback(() => {
    if (marqueeDraft && tool === 'select') {
      const point = getPointerPoint();
      if (point) setMarqueeDraft((draft) => (draft ? { ...draft, current: point } : null));
      return;
    }
    if (!creationDraft) return;
    const point = getPointerPoint();
    if (point) setCreationDraft((draft) => (draft ? { ...draft, current: point } : null));
  }, [creationDraft, getPointerPoint, marqueeDraft, setCreationDraft, setMarqueeDraft, tool]);

  const handleStageMouseUp = useCallback(() => {
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

    if (draft.tool === 'seat') {
      const seatBlock = getSeatBlockConfigForBounds(
        box.width >= 6 && box.height >= 6
          ? box
          : { x: draft.start.x, y: draft.start.y, width: 260, height: 160 },
          map?.referenceChart?.calibration,
          Math.max(1, (map?.seats.length ?? 0) + 1),
          seatBlockDefaults,
      );
      addSeatBlockAt(seatBlock.origin, seatBlock.config);
      return;
    }

    if (draft.tool === 'text') {
      if (box.width >= 6 && box.height >= 6) {
        openNewTextEditor({ x: box.x, y: box.y, width: Math.max(20, box.width), height: Math.max(20, box.height), textMode: 'area' });
      } else if (box.width >= 6) {
        openNewTextEditor({ x: box.x, y: box.y, width: Math.max(20, box.width), height: null, textMode: 'fixed-width' });
      } else {
        openNewTextEditor({ x: draft.start.x, y: draft.start.y, width: null, height: null, textMode: 'auto' });
      }
      return;
    }
    if (box.width < 6 || box.height < 6) {
      addObjectAt(draft.tool, draft.start);
      return;
    }
    addObjectAt(draft.tool, { x: box.x, y: box.y }, { width: Math.max(20, box.width), height: Math.max(20, box.height) });
  }, [addObjectAt, addSeatBlockAt, creationDraft, getMarqueeSelection, getPointerPoint, levelId, map?.referenceChart?.calibration, map?.seats.length, marqueeDraft, openNewTextEditor, seatBlockDefaults, setCreationDraft, setMarqueeDraft, setSelection, tool]);

  const handleStageClick = useCallback(() => undefined, []);

  return { handleStageMouseDown, handleStageMouseMove, handleStageMouseUp, handleStageClick };
}
