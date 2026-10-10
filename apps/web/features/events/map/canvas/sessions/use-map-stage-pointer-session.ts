'use client';

import { isSameSelectionItem, normalizeBoundsRect, type MapSelection, type SeatBlockConfig, type TextMode } from '@alusa/domain';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useRef } from 'react';
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
  selection,
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
  selection: MapSelection;
  setSelection: (selection: MapSelection | null) => void;
  setIndividualSeatDragId: Dispatch<SetStateAction<string | null>>;
  getMarqueeSelection: (box: { x: number; y: number; width: number; height: number }) => MapSelection;
  openNewTextEditor: (box: { x: number; y: number; width: number | null; height: number | null; textMode: TextMode }) => void;
  creationDraft: CreationDraft | null;
  setCreationDraft: Dispatch<SetStateAction<CreationDraft | null>>;
  marqueeDraft: MarqueeDraft | null;
  setMarqueeDraft: Dispatch<SetStateAction<MarqueeDraft | null>>;
}) {
  const additiveMarqueeRef = useRef(false);
  const handleStageMouseDown = useCallback((event: { target: Konva.Node; evt?: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'> }) => {
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
      additiveMarqueeRef.current = Boolean(event.evt?.shiftKey || event.evt?.ctrlKey || event.evt?.metaKey);
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

  const handleStageMouseUp = useCallback((event?: { evt?: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'> }) => {
    const activeLevel = map?.levels.find((level) => level.id === levelId);
    const isInsideArtboard = (point: { x: number; y: number } | null) =>
      Boolean(point && (!activeLevel || (point.x >= 0 && point.y >= 0 && point.x <= activeLevel.widthPx && point.y <= activeLevel.heightPx)));
    if (marqueeDraft && tool === 'select') {
      const point = getPointerPoint();
      if (!point) {
        setMarqueeDraft(null);
        additiveMarqueeRef.current = false;
        return;
      }
      const marqueeBox = normalizeBoundsRect(marqueeDraft.start, point);
      const box = activeLevel
        ? (() => {
            const left = Math.min(activeLevel.widthPx, Math.max(0, marqueeBox.x));
            const top = Math.min(activeLevel.heightPx, Math.max(0, marqueeBox.y));
            const right = Math.min(activeLevel.widthPx, Math.max(0, marqueeBox.x + marqueeBox.width));
            const bottom = Math.min(activeLevel.heightPx, Math.max(0, marqueeBox.y + marqueeBox.height));
            return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
          })()
        : marqueeBox;
      setMarqueeDraft(null);
      if (box.width >= 4 || box.height >= 4) {
        const items = getMarqueeSelection(box);
        const additive = additiveMarqueeRef.current || Boolean(event?.evt?.shiftKey || event?.evt?.ctrlKey || event?.evt?.metaKey);
        if (additive) {
          if (items.length > 0) {
            const next = selection.filter((entry) => entry.type !== 'level');
            for (const item of items) {
              if (item.type === 'level') continue;
              if (!next.some((entry) => isSameSelectionItem(entry, item))) next.push(item);
            }
            setSelection(next);
          }
        } else {
          setSelection(items.length > 0 ? items : levelId ? [{ type: 'level', id: levelId }] : []);
        }
      } else {
        const additive = additiveMarqueeRef.current || Boolean(event?.evt?.shiftKey || event?.evt?.ctrlKey || event?.evt?.metaKey);
        if (!additive) {
          setSelection(isInsideArtboard(point) && levelId ? [{ type: 'level', id: levelId }] : []);
        }
      }
      additiveMarqueeRef.current = false;
      return;
    }
    if (!creationDraft) return;
    const point = getPointerPoint();
    if (!point || !isInsideArtboard(point)) {
      setCreationDraft(null);
      return;
    }
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
  }, [addObjectAt, addSeatBlockAt, creationDraft, getMarqueeSelection, getPointerPoint, levelId, map?.levels, map?.referenceChart?.calibration, map?.seats.length, marqueeDraft, openNewTextEditor, seatBlockDefaults, selection, setCreationDraft, setMarqueeDraft, setSelection, tool]);

  const handleStageClick = useCallback(() => undefined, []);

  return { handleStageMouseDown, handleStageMouseMove, handleStageMouseUp, handleStageClick };
}
