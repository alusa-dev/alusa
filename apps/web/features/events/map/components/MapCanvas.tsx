'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Ellipse, Group, Layer, Line, Rect, RegularPolygon, Stage, Text, Transformer } from 'react-konva';

import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { useSnapGuidesSession } from '../hooks/useSnapGuidesSession';
import {
  applyScrubZoom,
  computeScrubDelta,
} from '../lib/zoom-scrub';
import {
  buildSmartCorridorDragPreview,
  buildSmartCorridorTransformPreview,
  cloneEventMap,
  CORRIDOR_REFLOW_ITERATIONS,
  extractCorridorDragCommitUpdates,
  extractGroupDragCommitUpdates,
  resolveCorridorDragMode,
  type CorridorDragMode,
} from '../lib/corridor-reflow';
import {
  beginMapTransformSession,
  applyMapTransformLivePreview,
  buildMapTransformCommit,
  resetMapTransformTransformer,
  type MapTransformSession,
} from '../lib/map-transform-session';
import { buildCorridorTransformCommitPatches } from '../lib/corridor-transform-session';
import {
  DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  resolveCorridorTransformerScaleOptions,
  resolveGenericTransformerScaleOptions,
  resolveUniformTransformerScaleOptions,
  type TransformerScaleOptions,
} from '../lib/transform-handle-mode';
import { corridorPatchesToDomainOperations } from '../lib/corridor-domain-transform-bridge';
import { recordCorridorDomainOperations } from '../lib/event-map-e2e-bridge';
import { resolveTransformRouting } from '../lib/transform-routing';
import {
  captureTransformNodeSnapshots,
  restoreTransformNodeSnapshots,
  type TransformNodeSnapshot,
} from '../lib/transform-cancel';
import { applyCorridorPreviewToStage, restoreCorridorStageFromMap } from '../lib/corridor-preview-stage';
import { setEventMapE2ERenderMapProvider } from '../lib/event-map-e2e-bridge';
import { getCorridorUnionGroups } from '../lib/corridor-union';
import { polygonToKonvaPoints } from '../lib/corridor-domain-bridge';
import { resolveCorridorObjectsForRender } from '../lib/corridor-union-live';
import {
  applyCorridorNodeFromModel,
  syncCorridorNodesFromMap,
} from '../lib/corridor-canvas';
import {
  buildTextEditorState,
  getTextEditorDimensions,
  TEXT_EDITOR_PLACEHOLDER,
  type TextEditorState,
} from '../lib/text-editor-layout';
import { SNAP_TARGET_NAME, computeUnionBoundsFromNodes, getNodeBounds, isSnapModifierActive, type LevelBounds } from '../lib/snap-guides';
import {
  buildTextFontStyle,
  clampFontSizeValue,
  getKonvaTextDecoration,
  getTextDimensionsForMode,
  getTextMode,
  getTextModeFromCreation,
  getTextResizeAnchors,
  getTextWrap,
  isCornerResizeAnchor,
  isHorizontalResizeAnchor,
  isTextBoxMode,
  isVerticalResizeAnchor,
  normalizeTextData,
  type TextMode,
} from '../lib/text-object';
import { expandObjectSelectionItems, isObjectInSelectedGroup, resolveDragTarget, resolveGroupSelectionItem, selectionHasMixedTextAndShapes } from '../lib/object-groups';
import {
  getObjectBounds,
  getSeatBounds,
  getSelectableItems,
  intersectsRect,
  isItemSelected,
  isSameSelectionItem,
  normalizeBoundsRect,
  replaceSelection,
  type MapSelectionItem,
} from '../lib/selection-utils';
import {
  buildSeatGridPreview,
  DEFAULT_SEAT_GRID_CONFIG,
  getSeatGridPreviewBounds,
  SEAT_GRID_SECTION_PADDING,
  suggestNextSeatGridConfig,
  type SeatGridConfig,
} from '../lib/seat-grid';
import type { MapTool } from '../store/event-map-editor-store';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import {
  clampFontSize,
  clampObjectSize,
  MIN_OBJECT_SIZE,
} from '../lib/uniform-group-transform';
import { CreateSeatGridDialog } from './CreateSeatGridDialog';
import { CorridorMapObject, buildCorridorMapObjectProps } from './CorridorMapObject';
import { SnapGuidesLayer } from './SnapGuidesLayer';

type MarqueeDraft = {
  start: { x: number; y: number };
  current: { x: number; y: number };
};

type GroupDragState = {
  anchorNodeId: string;
  origin: Map<string, { x: number; y: number }>;
  delta: { x: number; y: number };
};

type SeatGroupResizeHandle = 'right' | 'bottom' | 'bottom-right';
type SeatGroupResizeState = {
  groupId: string;
  handle: SeatGroupResizeHandle;
  startWorldPt: { x: number; y: number };
  startRows: number;
  startColumns: number;
  startTotalW: number;
  startTotalH: number;
  stepX: number;
  stepY: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  gapX: number;
  gapY: number;
  lastCommittedRows: number;
  lastCommittedCols: number;
};

function isAdditiveSelect(event: Konva.KonvaEventObject<MouseEvent>) {
  return event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey;
}

const RESIZE_ANCHORS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'middle-left',
  'middle-right',
  'top-center',
  'bottom-center',
] as const;

function findItemsInMarquee(
  box: ReturnType<typeof normalizeBoundsRect>,
  objects: EventMapObjectDTO[],
  seats: EventSeatDTO[],
): MapSelectionItem[] {
  const items: MapSelectionItem[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    if (object.locked) continue;
    const bounds = getObjectBounds(object);
    if (!intersectsRect(box, bounds)) continue;

    const item: MapSelectionItem =
      object.sectionId && object.type === 'SECTION'
        ? { type: 'section', id: object.sectionId }
        : { type: 'object', id: object.id };
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  for (const seat of seats) {
    if (seat.status === 'SOLD') continue;
    if (!intersectsRect(box, getSeatBounds(seat))) continue;
    const key = `seat:${seat.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: 'seat', id: seat.id });
  }

  return items;
}

function isObjectSelected(object: EventMapObjectDTO, selection: MapSelectionItem[], objects: EventMapObjectDTO[]) {
  return (
    isItemSelected(selection, { type: 'object', id: object.id }) ||
    (object.sectionId ? isItemSelected(selection, { type: 'section', id: object.sectionId }) : false) ||
    isObjectInSelectedGroup(object, selection, objects)
  );
}

type CreationDraft = {
  tool: MapTool;
  start: { x: number; y: number };
  current: { x: number; y: number };
};

type SeatGridDraft = {
  origin: { x: number; y: number };
  config: SeatGridConfig;
};

function seatFill(status: EventSeatDTO['status']) {
  if (status === 'SOLD') return '#94a3b8';
  if (status === 'HELD') return '#f59e0b';
  if (status === 'BLOCKED' || status === 'UNAVAILABLE') return '#e2e8f0';
  if (status === 'COMPLIMENTARY') return '#8b5cf6';
  return '#10b981';
}

function objectStyle(object: EventMapObjectDTO) {
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827', text: '#ffffff' };
  if (object.type === 'BLOCKED_AREA') return { fill: '#e2e8f0', stroke: '#94a3b8', text: '#475569' };
  if (object.type === 'CORRIDOR') return { fill: '#f8fafc', stroke: '#cbd5e1', text: '#64748b' };
  if (object.type === 'TABLE') return { fill: '#fefce8', stroke: '#ca8a04', text: '#854d0e' };
  if (object.type === 'BOOTH') return { fill: '#fff7ed', stroke: '#ea580c', text: '#9a3412' };
  if (object.type === 'GENERAL_AREA' && object.data.shape) return { fill: String(object.data.fill ?? '#ffffff'), stroke: '#64748b', text: '#334155' };
  if (object.type === 'GENERAL_AREA') return { fill: '#ecfeff', stroke: '#0891b2', text: '#155e75' };
  return { fill: String(object.data.fill ?? '#f8fafc'), stroke: '#cbd5e1', text: '#334155' };
}

function getObjectStrokeDash(object: EventMapObjectDTO) {
  const strokeStyle = object.data.strokeStyle;
  if (strokeStyle === 'dashed') return [10, 6];
  if (strokeStyle === 'dotted') return [2, 6];
  if (object.type === 'CORRIDOR') return [8, 6];
  return undefined;
}

function isObjectAppearanceEnabled(value: unknown, fallback = true) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function getObjectAppearance(object: EventMapObjectDTO) {
  const style = objectStyle(object);
  const fillEnabled = isObjectAppearanceEnabled(object.data.fillEnabled);
  const strokeEnabled = isObjectAppearanceEnabled(object.data.strokeEnabled);
  const strokeWidthEnabled = isObjectAppearanceEnabled(object.data.strokeWidthEnabled);
  const strokeWidth = Number(object.data.strokeWidth ?? 1.5);
  const effectiveStrokeWidth = strokeEnabled && strokeWidthEnabled ? strokeWidth : 0;

  return {
    fill: fillEnabled ? String(object.data.fill ?? style.fill) : undefined,
    stroke: strokeEnabled && effectiveStrokeWidth > 0 ? String(object.data.stroke ?? style.stroke) : undefined,
    strokeWidth: effectiveStrokeWidth,
    dash: strokeEnabled && strokeWidthEnabled ? getObjectStrokeDash(object) : undefined,
  };
}

function isCreationTool(tool: MapTool) {
  return !['select', 'pan', 'zoom', 'row'].includes(tool);
}

function isPlacementTool(tool: MapTool) {
  return isCreationTool(tool) || tool === 'row';
}

function isProportionalTool(tool: MapTool) {
  return tool === 'shape-square' || tool === 'shape-circle';
}

function getCreationBox(draft: CreationDraft) {
  const rawWidth = draft.current.x - draft.start.x;
  const rawHeight = draft.current.y - draft.start.y;

  if (isProportionalTool(draft.tool)) {
    const size = Math.max(Math.abs(rawWidth), Math.abs(rawHeight));
    const width = rawWidth < 0 ? -size : size;
    const height = rawHeight < 0 ? -size : size;
    return {
      x: width < 0 ? draft.start.x + width : draft.start.x,
      y: height < 0 ? draft.start.y + height : draft.start.y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
  }

  return {
    x: Math.min(draft.start.x, draft.current.x),
    y: Math.min(draft.start.y, draft.current.y),
    width: Math.abs(rawWidth),
    height: Math.abs(rawHeight),
  };
}

function getCreationShape(tool: MapTool) {
  if (tool === 'shape-circle') return 'circle';
  if (tool === 'shape-ellipse') return 'ellipse';
  if (tool === 'shape-triangle') return 'triangle';
  return null;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

type ZoomScrubState = {
  origin: { x: number; y: number };
  anchor: { x: number; y: number };
  startZoom: number;
  startPan: { x: number; y: number };
};

export function MapCanvas({ readOnly }: { readOnly: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const contentLayerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [isPanning, setIsPanning] = useState(false);
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [seatGridDraft, setSeatGridDraft] = useState<SeatGridDraft | null>(null);
  const [individualSeatDragId, setIndividualSeatDragId] = useState<string | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<MarqueeDraft | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditorFocusKeyRef = useRef<string | null>(null);
  const textEditSnapshotRef = useRef<string | null>(null);
  const groupDragRef = useRef<GroupDragState | null>(null);
  const seatGroupResizeRef = useRef<SeatGroupResizeState | null>(null);
  const corridorPreviewBaseMapRef = useRef<EventMapDTO | null>(null);
  const corridorPreviewWorkingMapRef = useRef<EventMapDTO | null>(null);
  const corridorPreviewRafRef = useRef<number | null>(null);
  const corridorDragCorridorNodeIdsRef = useRef<string[]>([]);
  const corridorDragModeRef = useRef<CorridorDragMode>('reflow');
  const isCorridorLivePreviewRef = useRef(false);
  const isCorridorTransformActiveRef = useRef(false);
  const mapTransformSessionRef = useRef<MapTransformSession | null>(null);
  const transformReflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformCancelSnapshotsRef = useRef<TransformNodeSnapshot[]>([]);
  const transformCancelledRef = useRef(false);
  const transformContextRef = useRef({
    selectedObjectIds: [] as string[],
    selectedSeatIds: [] as string[],
    selectedNodeIds: [] as string[],
    transformKind: null as ReturnType<typeof resolveTransformRouting>['kind'],
    levelBounds: null as LevelBounds | null,
  });
  const committedGroupDragNodeIdsRef = useRef<Set<string>>(new Set());
  const zoomScrubRef = useRef<ZoomScrubState | null>(null);
  const [isTransformSessionActive, setIsTransformSessionActive] = useState(false);
  const [transformerScaleOptions, setTransformerScaleOptions] = useState<TransformerScaleOptions>(
    DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  );
  const [isZoomScrubbing, setIsZoomScrubbing] = useState(false);
  const [corridorVisualRevision, setCorridorVisualRevision] = useState(0);
  const [activeUnionDragIds, setActiveUnionDragIds] = useState<Set<string>>(() => new Set());
  const bumpCorridorVisualRevision = useCallback(() => {
    setCorridorVisualRevision((value) => value + 1);
  }, []);
  // After any transform, store committed {x,y} so the redundant dragend is skipped.
  // Works for resize (dragend fires with same position) AND rotation (dragend may not fire at all).
  const lastTransformCommitRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const map = useEventMapEditorStore((state) => state.map);
  const renderMap = map;
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
  const addSeatGridAt = useEventMapEditorStore((state) => state.addSeatGridAt);
  const updateObject = useEventMapEditorStore((state) => state.updateObject);
  const updateObjects = useEventMapEditorStore((state) => state.updateObjects);
  const updateMapItems = useEventMapEditorStore((state) => state.updateMapItems);
  const deleteObject = useEventMapEditorStore((state) => state.deleteObject);
  const updateSeat = useEventMapEditorStore((state) => state.updateSeat);
  const updateSeatGroup = useEventMapEditorStore((state) => state.updateSeatGroup);
  const deleteSeatGroup = useEventMapEditorStore((state) => state.deleteSeatGroup);
  const setInlineTextEditorActive = useEventMapEditorStore((state) => state.setInlineTextEditorActive);

  const level = useMemo(
    () => renderMap?.levels.find((item) => item.id === activeLevelId) ?? renderMap?.levels[0] ?? null,
    [renderMap, activeLevelId],
  );
  const levelBounds = useMemo(
    () => (level ? { width: level.widthPx, height: level.heightPx } : null),
    [level],
  );
  const levelObjects = useMemo(
    () => renderMap?.objects.filter((object) => object.levelId === level?.id && !object.hidden) ?? [],
    [renderMap, level?.id],
  );
  const displayLevelObjects = useMemo(() => {
    const livePreview = isCorridorLivePreviewRef.current || isTransformSessionActive;
    if (!livePreview) return levelObjects;
    return resolveCorridorObjectsForRender(stageRef.current, levelObjects, true);
  }, [levelObjects, corridorVisualRevision, isTransformSessionActive]);
  const levelSeats = useMemo(
    () => renderMap?.seats.filter((seat) => seat.levelId === level?.id && seat.publicVisible) ?? [],
    [renderMap, level?.id],
  );
  const levelSeatGroups = useMemo(
    () => renderMap?.seatGroups?.filter((g) => g.levelId === level?.id) ?? [],
    [renderMap, level?.id],
  );
  // Sections whose seats belong to a seatgroup — their SECTION object must NOT render
  // because renderSeatGroups() already draws the correct bounding rect.
  const seatGroupSectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const seat of levelSeats) {
      if (seat.groupId != null && seat.sectionId != null) {
        ids.add(seat.sectionId);
      }
    }
    return ids;
  }, [levelSeats]);
  const corridorUnionGroups = useMemo(() => {
    const corridors = displayLevelObjects.filter((object) => object.type === 'CORRIDOR');
    return getCorridorUnionGroups(corridors, 1);
  }, [displayLevelObjects]);
  const selectedCorridorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selection) {
      if (item.type !== 'object') continue;
      const object = levelObjects.find((entry) => entry.id === item.id);
      if (object?.type === 'CORRIDOR') ids.add(object.id);
    }
    return ids;
  }, [selection, levelObjects]);
  const seatGridPreviewSeats = useMemo(
    () => (seatGridDraft ? buildSeatGridPreview(seatGridDraft.origin, seatGridDraft.config) : []),
    [seatGridDraft],
  );

  const setViewportSize = useEventMapEditorStore((state) => state.setViewportSize);

  useEffect(() => {
    if (tool !== 'seat' || readOnly) {
      setSeatGridDraft(null);
    }
  }, [readOnly, tool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextSize = {
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      };
      setSize(nextSize);
      setViewportSize(nextSize);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setViewportSize]);

  useEffect(() => {
    if (tool !== 'zoom') {
      zoomScrubRef.current = null;
      setIsZoomScrubbing(false);
      return;
    }

    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    function onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;

      const rect = stage!.container().getBoundingClientRect();
      const { zoom: startZoom, pan: startPan } = useEventMapEditorStore.getState();

      zoomScrubRef.current = {
        origin: { x: event.clientX, y: event.clientY },
        anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
        startZoom,
        startPan: { ...startPan },
      };
      setIsZoomScrubbing(true);
      event.preventDefault();
    }

    function onMouseMove(event: MouseEvent) {
      const drag = zoomScrubRef.current;
      if (!drag) return;

      const scrubDelta = computeScrubDelta(
        { x: event.clientX, y: event.clientY },
        drag.origin,
      );
      if (Math.abs(scrubDelta) > 2) {
        useEventMapEditorStore.getState().markZoomScrubbedThisHold();
      }

      const result = applyScrubZoom({
        origin: drag.origin,
        current: { x: event.clientX, y: event.clientY },
        startZoom: drag.startZoom,
        startPan: drag.startPan,
        anchor: drag.anchor,
      });

      setZoom(result.zoom);
      setPan(result.pan);
    }

    function endScrub(event: MouseEvent) {
      const drag = zoomScrubRef.current;
      if (drag) {
        const scrubDelta = computeScrubDelta(
          { x: event.clientX, y: event.clientY },
          drag.origin,
        );
        if (Math.abs(scrubDelta) > 2) {
          useEventMapEditorStore.getState().restoreTemporaryZoomTool();
        }
      }
      zoomScrubRef.current = null;
      setIsZoomScrubbing(false);
    }

    container.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endScrub);

    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endScrub);
    };
  }, [setPan, setZoom, tool]);

  useEffect(() => {
    if (!textEditor) {
      textEditorFocusKeyRef.current = null;
      textEditSnapshotRef.current = null;
      return;
    }
    const textarea = textEditorRef.current;
    if (!textarea) return;
    const focusKey = `${textEditor.objectId ?? 'new'}:${textEditor.left}:${textEditor.top}:${textEditor.textMode}`;
    if (textEditorFocusKeyRef.current === focusKey) return;
    textEditorFocusKeyRef.current = focusKey;
    textarea.focus();
    if (textEditor.objectId && textEditor.value) textarea.select();
  }, [textEditor?.objectId, textEditor?.left, textEditor?.top, textEditor?.textMode, textEditor?.value]);

  useEffect(() => {
    if (!textEditor) return;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;

    const node = textEditor.objectId ? stage.findOne(`#node-${textEditor.objectId}`) : null;
    setTextEditor((current) => {
      if (!current) return current;
      return buildTextEditorState({
        objectId: current.objectId,
        value: current.value,
        mapX: current.mapX,
        mapY: current.mapY,
        mapWidth: current.mapWidth,
        mapHeight: current.mapHeight,
        textMode: current.textMode,
        rotation: current.rotation,
        baseFontSize: current.baseFontSize,
        fontFamily: current.fontFamily,
        fontWeight: current.fontWeight,
        letterSpacing: current.letterSpacing,
        color: current.color,
        lineHeight: current.lineHeight,
        textAlign: current.textAlign,
        stage,
        container,
        zoom,
        pan,
        node: node instanceof Konva.Text ? node : null,
      });
    });
  }, [pan.x, pan.y, zoom, textEditor?.objectId, textEditor?.value, textEditor?.textMode]);

  useEffect(() => {
    if (readOnly || textEditor) return;

    function onEnterEdit(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;

      const store = useEventMapEditorStore.getState();
      if (store.tool !== 'select') return;
      const selectable = getSelectableItems(store.selection);
      if (selectable.length !== 1 || selectable[0]?.type !== 'object') return;
      const object = store.map?.objects.find((entry) => entry.id === selectable[0]?.id);
      if (!object || object.type !== 'TEXT' || object.locked) return;

      event.preventDefault();
      const stage = stageRef.current;
      const container = containerRef.current;
      const node = stage?.findOne(`#node-${object.id}`);
      if (!stage || !container || !(node instanceof Konva.Text)) return;

      textEditSnapshotRef.current = String(object.data.text ?? '');
      const groupItems = resolveGroupSelectionItem({ type: 'object', id: object.id }, levelObjects);
      setSelection(groupItems.length > 1 ? groupItems : replaceSelection({ type: 'object', id: object.id }));
      setInlineTextEditorActive(true);
      setTextEditor(
        buildTextEditorState({
          objectId: object.id,
          value: String(object.data.text ?? ''),
          mapX: object.x,
          mapY: object.y,
          mapWidth: typeof object.width === 'number' ? object.width : null,
          mapHeight: typeof object.height === 'number' ? object.height : null,
          textMode: getTextMode(object),
          rotation: object.rotation ?? 0,
          baseFontSize: Number(object.data.fontSize ?? 22),
          fontFamily: String(object.data.fontFamily ?? 'Inter, sans-serif'),
          fontWeight: String(object.data.fontWeight ?? 'normal'),
          letterSpacing: Number(object.data.letterSpacing ?? 0),
          color: String(object.data.fill ?? '#0f172a'),
          lineHeight: Number(object.data.lineHeight ?? 1.2),
          textAlign: String(object.data.align ?? 'left') as TextEditorState['textAlign'],
          stage,
          container,
          zoom,
          pan,
          node,
        }),
      );
    }

    window.addEventListener('keydown', onEnterEdit);
    return () => window.removeEventListener('keydown', onEnterEdit);
  }, [levelObjects, pan, readOnly, setSelection, textEditor, zoom]);

  const selectedNodeIds = useMemo(() => {
    if (!map || selection.length === 0) return [];

    const items = selection.flatMap((item) => {
      if (item.type === 'object' || item.type === 'seat') return [item];
      if (item.type === 'section') {
        const object = map.objects.find((entry) => entry.sectionId === item.id && entry.type === 'SECTION');
        const seats = map.seats
          .filter((seat) => seat.sectionId === item.id && seat.status !== 'SOLD')
          .map((seat) => ({ type: 'seat' as const, id: seat.id }));
        return object ? [{ type: 'object' as const, id: object.id }, ...seats] : seats;
      }
      return [];
    });

    return expandObjectSelectionItems(items, map.objects).flatMap((item) => {
      if (item.type === 'object' || item.type === 'seat') return [`node-${item.id}`];
      return [];
    });
  }, [selection, map]);

  const selectedObjectIds = useMemo(
    () => {
      if (!map) return [];
      const objectIds = new Set(map.objects.map((object) => object.id));
      return selectedNodeIds.map((nodeId) => nodeId.replace(/^node-/, '')).filter((id) => objectIds.has(id));
    },
    [selectedNodeIds, map],
  );

  const selectedSeatIds = useMemo(
    () => {
      if (!map) return [];
      const seatIds = new Set(map.seats.map((seat) => seat.id));
      return selectedNodeIds.map((nodeId) => nodeId.replace(/^node-/, '')).filter((id) => seatIds.has(id));
    },
    [selectedNodeIds, map],
  );

  const selectedAnyCorridor = useMemo(() => {
    if (!map) return false;
    return selectedObjectIds.some((id) =>
      map.objects.some((object) => object.id === id && object.type === 'CORRIDOR'),
    );
  }, [map, selectedObjectIds]);

  const selectionContainsSeatsOrSections = useMemo(() => {
    if (selectedSeatIds.length > 0) return true;
    return selection.some((item) => item.type === 'section');
  }, [selectedSeatIds, selection]);

  useEffect(() => {
    setEventMapE2ERenderMapProvider(
      () =>
        corridorPreviewWorkingMapRef.current ??
        useEventMapEditorStore.getState().map,
    );
    return () => setEventMapE2ERenderMapProvider(null);
  }, [map]);

  const cancelCorridorPreviewFrame = useCallback(() => {
    if (corridorPreviewRafRef.current === null) return;
    cancelAnimationFrame(corridorPreviewRafRef.current);
    corridorPreviewRafRef.current = null;
  }, []);

  const clearSmartCorridorPreview = useCallback(() => {
    cancelCorridorPreviewFrame();

    if (isCorridorLivePreviewRef.current) {
      const stage = stageRef.current;
      const currentMap = useEventMapEditorStore.getState().map;
      const levelId = useEventMapEditorStore.getState().activeLevelId;
      if (stage && currentMap && levelId) {
        restoreCorridorStageFromMap(stage, currentMap, levelId);
        contentLayerRef.current?.batchDraw();
      }
    }

    corridorPreviewBaseMapRef.current = null;
    corridorPreviewWorkingMapRef.current = null;
    corridorDragCorridorNodeIdsRef.current = [];
    corridorDragModeRef.current = 'reflow';
    isCorridorLivePreviewRef.current = false;
    isCorridorTransformActiveRef.current = false;
    mapTransformSessionRef.current = null;
    if (transformReflowTimerRef.current) {
      clearTimeout(transformReflowTimerRef.current);
      transformReflowTimerRef.current = null;
    }
    setIsTransformSessionActive(false);
    setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);
    setActiveUnionDragIds(new Set());
    bumpCorridorVisualRevision();
  }, [bumpCorridorVisualRevision, cancelCorridorPreviewFrame]);

  const runCorridorDragPreviewFrame = useCallback(() => {
    corridorPreviewRafRef.current = null;

    const baseMap = corridorPreviewBaseMapRef.current;
    const drag = groupDragRef.current;
    const stage = stageRef.current;
    const levelId = useEventMapEditorStore.getState().activeLevelId;
    const corridorNodeIds = corridorDragCorridorNodeIdsRef.current;

    if (!baseMap || !drag || !stage || !levelId || corridorNodeIds.length === 0) return;

    if (!corridorPreviewWorkingMapRef.current) {
      corridorPreviewWorkingMapRef.current = cloneEventMap(baseMap);
    }

    const activeCorridorIds = corridorNodeIds.map((nodeId) => nodeId.replace(/^node-/, ''));
    const dragMode =
      corridorDragModeRef.current ||
      resolveCorridorDragMode(baseMap, drag, activeCorridorIds);
    corridorDragModeRef.current = dragMode;

    const preview = buildSmartCorridorDragPreview(baseMap, drag, corridorNodeIds, {
      previewMap: corridorPreviewWorkingMapRef.current,
      maxIterations: CORRIDOR_REFLOW_ITERATIONS,
      activeCorridorIds,
      mode: dragMode,
    });

    applyCorridorPreviewToStage(stage, preview, baseMap, corridorNodeIds, levelId, {
      syncCorridorGeometry: false,
    });
    contentLayerRef.current?.batchDraw();
    bumpCorridorVisualRevision();
  }, [bumpCorridorVisualRevision]);

  const scheduleCorridorDragPreview = useCallback(() => {
    if (corridorPreviewRafRef.current !== null) return;
    corridorPreviewRafRef.current = requestAnimationFrame(runCorridorDragPreviewFrame);
  }, [runCorridorDragPreviewFrame]);

  const flushCorridorDragPreview = useCallback(() => {
    cancelCorridorPreviewFrame();
    runCorridorDragPreviewFrame();
  }, [cancelCorridorPreviewFrame, runCorridorDragPreviewFrame]);

  const mixedTextAndShapes = useMemo(() => {
    if (!map || selectedObjectIds.length < 2) return false;
    return selectionHasMixedTextAndShapes(map.objects, selectedObjectIds);
  }, [map, selectedObjectIds]);

  const selectedTextCount = useMemo(() => {
    if (!map || selectedObjectIds.length === 0) return 0;
    return selectedObjectIds.filter((id) => map.objects.some((object) => object.id === id && object.type === 'TEXT')).length;
  }, [map, selectedObjectIds]);

  const transformRouting = useMemo(
    () =>
      resolveTransformRouting({
        selectedNodeCount: selectedNodeIds.length,
        selectedObjectIds,
        objects: map?.objects ?? [],
        mixedTextAndShapes,
        selectedTextCount,
        selectionContainsSeatsOrSections,
      }),
    [
      map?.objects,
      mixedTextAndShapes,
      selectedNodeIds.length,
      selectedObjectIds,
      selectedTextCount,
      selectionContainsSeatsOrSections,
    ],
  );

  const useUniformGroupTransform = transformRouting.kind === 'uniform';
  const useCorridorTransformerPipeline = transformRouting.kind === 'corridor';
  const useGenericTransform = transformRouting.kind === 'generic';

  const isSingleSelectionTransform = selectedNodeIds.length <= 1;
  const transformPipelineActive = transformRouting.kind !== null;

  transformContextRef.current = {
    selectedObjectIds,
    selectedSeatIds,
    selectedNodeIds,
    transformKind: transformRouting.kind,
    levelBounds,
  };

  const disableResizeForMixedSmartCorridorSelection = transformRouting.transformDisabled;
  const disableRotateForMixedSmartCorridorSelection = transformRouting.transformDisabled;

  const selectedTextTransformAnchors = useMemo(() => {
    if (selectedObjectIds.length !== 1) return [...RESIZE_ANCHORS];
    const object = levelObjects.find((entry) => entry.id === selectedObjectIds[0]);
    if (!object || object.type !== 'TEXT') return [...RESIZE_ANCHORS];
    return [...getTextResizeAnchors(getTextMode(object))];
  }, [levelObjects, selectedObjectIds]);

  const ROTATION_SNAPS_15 = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345];
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Shift') return;
      if (selectedAnyCorridor) return;
      const tr = transformerRef.current;
      if (!tr) return;
      if (e.type === 'keydown') {
        tr.rotationSnaps(ROTATION_SNAPS_15);
        tr.rotationSnapTolerance(7);
      } else {
        tr.rotationSnaps([]);
        tr.rotationSnapTolerance(5);
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [selectedAnyCorridor]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage || !transformPipelineActive || !map) return;

    function buildCorridorSnapContext() {
      const ctx = transformContextRef.current;
      const currentMap = useEventMapEditorStore.getState().map;
      if (!currentMap || !ctx.levelBounds) return undefined;

      const skipIds = new Set(ctx.selectedObjectIds);
      const objectBounds = currentMap.objects
        .filter((object) => object.levelId === level?.id && !object.hidden && !skipIds.has(object.id))
        .map((object) => getObjectBounds(object));

      return {
        levelBounds: ctx.levelBounds,
        objectBounds,
      };
    }

    function scheduleDebouncedReflowPreview() {
      const session = mapTransformSessionRef.current;
      if (!session || session.kind !== 'corridor' || !session.corridor) return;
      if (session.corridor.mode === 'rotate' && session.corridor.snapshots.length < 2) return;

      if (transformReflowTimerRef.current) clearTimeout(transformReflowTimerRef.current);
      transformReflowTimerRef.current = setTimeout(() => {
        transformReflowTimerRef.current = null;
        const baseMap = corridorPreviewBaseMapRef.current;
        const corridorSession = mapTransformSessionRef.current?.corridor;
        const levelId = useEventMapEditorStore.getState().activeLevelId;
        if (!baseMap || !corridorSession || !levelId) return;

        const patches = buildCorridorTransformCommitPatches(
          corridorSession,
          { stage: stage!, transformer: transformer! },
          buildCorridorSnapContext(),
        );
        if (patches.length === 0) return;

        const preview = buildSmartCorridorTransformPreview(baseMap, patches, {
          previewMap: corridorPreviewWorkingMapRef.current ?? undefined,
          maxIterations: CORRIDOR_REFLOW_ITERATIONS,
          activeCorridorIds: corridorSession.corridorIds,
        });
        applyCorridorPreviewToStage(
          stage!,
          preview,
          baseMap,
          corridorSession.corridorIds.map((id) => `node-${id}`),
          levelId,
          { syncCorridorGeometry: false },
        );
        contentLayerRef.current?.batchDraw();
      }, 100);
    }

    function onTransformStart() {
      transformCancelledRef.current = false;
      const ctx = transformContextRef.current;
      const transformKind = ctx.transformKind;
      if (!transformKind) return;

      const currentMap = useEventMapEditorStore.getState().map;
      if (!currentMap) return;

      transformCancelSnapshotsRef.current = captureTransformNodeSnapshots(stage!, ctx.selectedNodeIds);

      const corridorIds = ctx.selectedObjectIds.filter((objectId) =>
        currentMap.objects.some((entry) => entry.id === objectId && entry.type === 'CORRIDOR'),
      );

      const anchor = transformer!.getActiveAnchor() ?? '';

      if (transformKind === 'corridor') {
        corridorPreviewBaseMapRef.current = cloneEventMap(currentMap);
        corridorPreviewWorkingMapRef.current = cloneEventMap(currentMap);
        isCorridorTransformActiveRef.current = true;
        setIsTransformSessionActive(true);
        setTransformerScaleOptions(resolveCorridorTransformerScaleOptions(anchor, corridorIds.length));
      } else if (transformKind === 'uniform') {
        setIsTransformSessionActive(true);
        setTransformerScaleOptions(resolveUniformTransformerScaleOptions());
      } else if (transformKind === 'generic') {
        setIsTransformSessionActive(true);
        setTransformerScaleOptions(resolveGenericTransformerScaleOptions(false));
      }

      const session = beginMapTransformSession({
        kind: transformKind,
        map: currentMap,
        corridorIds,
        selectedObjectIds: ctx.selectedObjectIds,
        selectedSeatIds: ctx.selectedSeatIds,
        stage: stage!,
        transformer: transformer!,
      });
      if (!session) return;
      mapTransformSessionRef.current = session;
    }

    function onTransform() {
      const session = mapTransformSessionRef.current;
      if (!session) return;

      applyMapTransformLivePreview(session, {
        stage: stage!,
        transformer: transformer!,
        snap: buildCorridorSnapContext(),
      });
      transformer!.getLayer()?.batchDraw();
      scheduleDebouncedReflowPreview();
    }

    function onTransformEnd() {
      if (transformCancelledRef.current) {
        transformCancelledRef.current = false;
        return;
      }

      const ctx = transformContextRef.current;
      const session = mapTransformSessionRef.current;
      const currentMap = useEventMapEditorStore.getState().map;
      if (!currentMap) return;

      if (transformReflowTimerRef.current) {
        clearTimeout(transformReflowTimerRef.current);
        transformReflowTimerRef.current = null;
      }

      const corridorIds = ctx.selectedObjectIds.filter((objectId) =>
        currentMap.objects.some((entry) => entry.id === objectId && entry.type === 'CORRIDOR'),
      );

      const commit = session
        ? buildMapTransformCommit(
            session,
            { stage: stage!, transformer: transformer!, snap: buildCorridorSnapContext() },
            currentMap,
          )
        : { objectUpdates: [], seatUpdates: [], corridorPatches: [] };

      for (const entry of commit.objectUpdates) {
        lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
      }
      for (const entry of commit.seatUpdates) {
        lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
      }

      if (session?.kind === 'uniform' && commit.objectUpdates.length > 0) {
        updateObjects(commit.objectUpdates.map((entry) => ({ id: entry.id, patch: entry.patch })));
      } else if (session?.kind === 'generic' && commit.objectUpdates.length > 0) {
        updateObjects(commit.objectUpdates.map((entry) => ({ id: entry.id, patch: entry.patch })));
      } else if (session?.kind === 'corridor' && corridorIds.length > 0) {
        const baseMap = corridorPreviewBaseMapRef.current ?? cloneEventMap(currentMap);
        const patches = commit.corridorPatches;
        const sessionAnchor = session.corridor?.anchor;

        for (const patch of patches) {
          lastTransformCommitRef.current.set(patch.objectId, {
            x: patch.patch.x ?? 0,
            y: patch.patch.y ?? 0,
          });
        }

        recordCorridorDomainOperations(corridorPatchesToDomainOperations(patches, sessionAnchor));

        if (patches.length > 0) {
          const preview = buildSmartCorridorTransformPreview(baseMap, patches, {
            previewMap: corridorPreviewWorkingMapRef.current ?? undefined,
            maxIterations: CORRIDOR_REFLOW_ITERATIONS,
            activeCorridorIds: corridorIds,
          });
          const { objects: corridorObjects, seats: reflowedSeats } = extractCorridorDragCommitUpdates(
            baseMap,
            preview,
            corridorIds,
          );

          updateMapItems({
            objects: [...commit.objectUpdates, ...corridorObjects],
            seats: reflowedSeats.length > 0 ? reflowedSeats : commit.seatUpdates,
            skipSeatBaseLayoutTranslation: reflowedSeats.length > 0,
            skipCorridorReflow: corridorIds.length > 0,
          });
        } else if (commit.objectUpdates.length > 0 || commit.seatUpdates.length > 0) {
          updateMapItems({ objects: commit.objectUpdates, seats: commit.seatUpdates });
        }
      } else if (commit.objectUpdates.length > 0 || commit.seatUpdates.length > 0) {
        updateMapItems({ objects: commit.objectUpdates, seats: commit.seatUpdates });
      }

      if (session) resetMapTransformTransformer(session, transformer!);

      isCorridorTransformActiveRef.current = false;
      mapTransformSessionRef.current = null;
      corridorPreviewBaseMapRef.current = null;
      corridorPreviewWorkingMapRef.current = null;
      transformCancelSnapshotsRef.current = [];
      setIsTransformSessionActive(false);
      setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);

      const levelId = useEventMapEditorStore.getState().activeLevelId;
      const committedMap = useEventMapEditorStore.getState().map;
      if (committedMap && levelId) {
        syncCorridorNodesFromMap(stage!, committedMap.objects, levelId);
      }

      const nodes = ctx.selectedNodeIds
        .map((nodeId) => stage!.findOne(`#${nodeId}`))
        .filter((node): node is Konva.Node => Boolean(node));
      transformer!.nodes(nodes);
      transformer!.getLayer()?.batchDraw();
      bumpCorridorVisualRevision();
    }

    transformer.on('transformstart', onTransformStart);
    transformer.on('transform', onTransform);
    transformer.on('transformend', onTransformEnd);

    return () => {
      transformer.off('transformstart', onTransformStart);
      transformer.off('transform', onTransform);
      transformer.off('transformend', onTransformEnd);
      mapTransformSessionRef.current = null;
      isCorridorTransformActiveRef.current = false;
      if (transformReflowTimerRef.current) {
        clearTimeout(transformReflowTimerRef.current);
        transformReflowTimerRef.current = null;
      }
    };
  }, [transformPipelineActive, map, level?.id, updateMapItems, updateObjects, bumpCorridorVisualRevision]);

  useEffect(() => {
    if (!isTransformSessionActive) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      const stage = stageRef.current;
      const transformer = transformerRef.current;
      const snapshots = transformCancelSnapshotsRef.current;
      if (!stage || !transformer || snapshots.length === 0) return;

      event.preventDefault();
      transformCancelledRef.current = true;

      if (transformReflowTimerRef.current) {
        clearTimeout(transformReflowTimerRef.current);
        transformReflowTimerRef.current = null;
      }

      restoreTransformNodeSnapshots(stage, snapshots);

      const session = mapTransformSessionRef.current;
      if (session) resetMapTransformTransformer(session, transformer);

      isCorridorTransformActiveRef.current = false;
      mapTransformSessionRef.current = null;
      corridorPreviewBaseMapRef.current = null;
      corridorPreviewWorkingMapRef.current = null;
      transformCancelSnapshotsRef.current = [];
      setIsTransformSessionActive(false);
      setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);

      const levelId = useEventMapEditorStore.getState().activeLevelId;
      const committedMap = useEventMapEditorStore.getState().map;
      if (committedMap && levelId) {
        syncCorridorNodesFromMap(stage, committedMap.objects, levelId);
      }

      const ctx = transformContextRef.current;
      const nodes = ctx.selectedNodeIds
        .map((nodeId) => stage.findOne(`#${nodeId}`))
        .filter((node): node is Konva.Node => Boolean(node));
      transformer.nodes(nodes);
      transformer.getLayer()?.batchDraw();
      bumpCorridorVisualRevision();
    }

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isTransformSessionActive, bumpCorridorVisualRevision]);

  useEffect(() => {
    if (!isTransformSessionActive) return;

    function onShiftKey(event: KeyboardEvent) {
      if (event.key !== 'Shift') return;
      if (transformContextRef.current.transformKind !== 'generic') return;
      setTransformerScaleOptions(resolveGenericTransformerScaleOptions(event.type === 'keydown'));
    }

    window.addEventListener('keydown', onShiftKey);
    window.addEventListener('keyup', onShiftKey);
    return () => {
      window.removeEventListener('keydown', onShiftKey);
      window.removeEventListener('keyup', onShiftKey);
    };
  }, [isTransformSessionActive]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!stage || !level?.id) return;

    if (!isCorridorLivePreviewRef.current && !isCorridorTransformActiveRef.current) {
      syncCorridorNodesFromMap(stage, levelObjects, level.id);
      contentLayerRef.current?.batchDraw();
    }

    if (!transformer || selectedNodeIds.length === 0) {
      transformer?.nodes([]);
      transformer?.getLayer()?.batchDraw();
      return;
    }
    if (isCorridorLivePreviewRef.current || isCorridorTransformActiveRef.current) return;

    const nodes = selectedNodeIds
      .map((nodeId) => stage.findOne(`#${nodeId}`))
      .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [level?.id, levelObjects, selectedNodeIds]);

  const handleSelectItem = useCallback(
    (item: MapSelectionItem, event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      setIndividualSeatDragId(null);
      const groupItems = item.type === 'object' ? resolveGroupSelectionItem(item, levelObjects) : [item];

      if (isAdditiveSelect(event)) {
        const allSelected = groupItems.every((entry) => isItemSelected(selection, entry));
        if (allSelected) {
          setSelection(selection.filter((entry) => !groupItems.some((groupItem) => isSameSelectionItem(entry, groupItem))));
          return;
        }

        const next: MapSelectionItem[] = selection.filter((entry) => entry.type !== 'level');
        for (const groupItem of groupItems) {
          if (!next.some((entry) => isSameSelectionItem(entry, groupItem))) {
            next.push(groupItem);
          }
        }
        setSelection(next);
        return;
      }

      setSelection(groupItems);
    },
    [levelObjects, selection, setSelection],
  );

  const getSectionGroupNodeIds = useCallback(
    (sectionId: string) => {
      const linkedObject = levelObjects.find((object) => object.sectionId === sectionId && object.type === 'SECTION');
      const seatNodeIds = levelSeats
        .filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD')
        .map((seat) => `node-${seat.id}`);

      return linkedObject ? [`node-${linkedObject.id}`, ...seatNodeIds] : seatNodeIds;
    },
    [levelObjects, levelSeats],
  );

  const beginGroupDrag = useCallback((nodeId: string, nodeIds: string[]) => {
    committedGroupDragNodeIdsRef.current.clear();
    if (!nodeIds.includes(nodeId)) {
      groupDragRef.current = null;
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;

    const currentMap = useEventMapEditorStore.getState().map;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of nodeIds) {
      const entityId = id.replace(/^node-/, '');
      const object = currentMap?.objects.find((entry) => entry.id === entityId);
      if (object) {
        origin.set(id, { x: object.x, y: object.y });
        continue;
      }

      const seat = currentMap?.seats.find((entry) => entry.id === entityId);
      if (seat) {
        origin.set(id, { x: seat.x, y: seat.y });
        continue;
      }

      const node = stage.findOne(`#${id}`);
      if (node) origin.set(id, { x: node.x(), y: node.y() });
    }

    if (origin.size <= 1) {
      groupDragRef.current = { anchorNodeId: nodeId, origin, delta: { x: 0, y: 0 } };
      return;
    }

    groupDragRef.current = { anchorNodeId: nodeId, origin, delta: { x: 0, y: 0 } };
  }, []);

  const syncGroupDrag = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.anchorNodeId !== event.target.id()) return;

    const anchorOrigin = drag.origin.get(drag.anchorNodeId);
    if (!anchorOrigin) return;

    const dx = event.target.x() - anchorOrigin.x;
    const dy = event.target.y() - anchorOrigin.y;
    drag.delta = { x: dx, y: dy };
    const stage = stageRef.current;
    if (!stage) return;

    for (const [nodeId, start] of drag.origin) {
      if (nodeId === drag.anchorNodeId) continue;
      const node = stage.findOne(`#${nodeId}`);
      if (!node) continue;
      node.x(start.x + dx);
      node.y(start.y + dy);
    }
  }, []);

  const commitGroupDrag = useCallback(() => {
    const drag = groupDragRef.current;
    groupDragRef.current = null;
    if (!drag) return;
    committedGroupDragNodeIdsRef.current = new Set(drag.origin.keys());

    const baseMap = corridorPreviewBaseMapRef.current;
    const corridorNodeIds = [...drag.origin.keys()].filter((nodeId) => {
      const id = nodeId.replace(/^node-/, '');
      return map?.objects.some((object) => object.id === id && object.type === 'CORRIDOR');
    });
    const movingCorridor = corridorNodeIds.length > 0;

    if (movingCorridor && baseMap) {
      flushCorridorDragPreview();

      const corridorIds = corridorNodeIds.map((nodeId) => nodeId.replace(/^node-/, ''));
      const dragMode = corridorDragModeRef.current || resolveCorridorDragMode(baseMap, drag, corridorIds);
      const preview = buildSmartCorridorDragPreview(baseMap, drag, corridorNodeIds, {
        previewMap: corridorPreviewWorkingMapRef.current ?? undefined,
        maxIterations: CORRIDOR_REFLOW_ITERATIONS,
        activeCorridorIds: corridorIds,
        mode: dragMode,
      });
      const { objects, seats } = extractGroupDragCommitUpdates(
        baseMap,
        preview,
        drag,
        corridorIds,
        dragMode,
      );

      if (objects.length > 0 || seats.length > 0) {
        updateMapItems({
          objects,
          seats,
          skipSeatBaseLayoutTranslation: dragMode === 'reflow',
          skipCorridorReflow: true,
        });
      }
      clearSmartCorridorPreview();
      return;
    }

    const { delta } = drag;
    const objectUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
    const seatUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];

    for (const [nodeId, start] of drag.origin) {
      const id = nodeId.replace('node-', '');
      const nx = start.x + delta.x;
      const ny = start.y + delta.y;

      if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) continue;

      if (map?.objects.some((object) => object.id === id)) {
        objectUpdates.push({ id, patch: { x: nx, y: ny } });
      } else if (map?.seats.some((seat) => seat.id === id)) {
        seatUpdates.push({ id, patch: { x: nx, y: ny } });
      }
    }

    if (objectUpdates.length > 0 || seatUpdates.length > 0) {
      updateMapItems({ objects: objectUpdates, seats: seatUpdates });
    }
    clearSmartCorridorPreview();
  }, [clearSmartCorridorPreview, flushCorridorDragPreview, map?.objects, map?.seats, updateMapItems]);

  const { guidesLayerRef, clearGuides, handleDragMove: handleSnapDragMove, handleAnchorDragBound } =
    useSnapGuidesSession({
    enabled: !readOnly && tool !== 'pan',
    levelBounds,
    zoom,
    stageRef,
    groupDragRef,
    syncGroupDrag,
  });

  const isSmartCorridorPreviewDrag = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    if (isCorridorLivePreviewRef.current) return true;
    if (!corridorPreviewBaseMapRef.current) return false;

    const current = useEventMapEditorStore.getState().map;
    if (!current) return false;

    const corridorIds = new Set(
      current.objects.filter((object) => object.type === 'CORRIDOR').map((object) => object.id),
    );
    if (corridorIds.size === 0) return false;

    const drag = groupDragRef.current;
    if (drag && drag.origin.size > 0) {
      return [...drag.origin.keys()].some((nodeId) => corridorIds.has(nodeId.replace(/^node-/, '')));
    }

    const entityId = event.target.id().replace(/^node-/, '');
    return corridorIds.has(entityId);
  }, []);

  const handleResponsiveDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      if (isSmartCorridorPreviewDrag(event)) {
        if (corridorDragModeRef.current === 'rigid') {
          handleSnapDragMove(event);
          scheduleCorridorDragPreview();
          return;
        }

        clearGuides();
        syncGroupDrag(event);
        scheduleCorridorDragPreview();
        return;
      }

      handleSnapDragMove(event);
    },
    [
      clearGuides,
      handleSnapDragMove,
      isSmartCorridorPreviewDrag,
      scheduleCorridorDragPreview,
      syncGroupDrag,
    ],
  );

  const CORRIDOR_ROTATION_SNAPS = [0, 90, 180, 270];
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || !selectedAnyCorridor) return;

    transformer.rotationSnaps(CORRIDOR_ROTATION_SNAPS);
    transformer.rotationSnapTolerance(5);

    return () => {
      transformer.rotationSnaps([]);
      transformer.rotationSnapTolerance(5);
    };
  }, [selectedAnyCorridor]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const onTransformStart = () => {
      clearGuides();
    };

    const onTransformEnd = () => {
      clearGuides();
    };

    transformer.on('transformstart', onTransformStart);
    transformer.on('transformend', onTransformEnd);
    return () => {
      transformer.off('transformstart', onTransformStart);
      transformer.off('transformend', onTransformEnd);
    };
  }, [clearGuides]);

  function getPointerPoint() {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - pan.x) / zoom,
      y: (pointer.y - pan.y) / zoom,
    };
  }

  function handleStageMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
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
          config: suggestNextSeatGridConfig(map?.seats ?? [], level?.id, DEFAULT_SEAT_GRID_CONFIG),
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
    setSelection(level ? [{ type: 'level', id: level.id }] : []);
  }

  function handleStageMouseMove(event: Konva.KonvaEventObject<MouseEvent>) {
    const seatResize = seatGroupResizeRef.current;
    if (seatResize) {
      const pt = getPointerPoint();
      if (!pt) return;
      const deltaX = pt.x - seatResize.startWorldPt.x;
      const deltaY = pt.y - seatResize.startWorldPt.y;
      let newCols = seatResize.lastCommittedCols;
      let newRows = seatResize.lastCommittedRows;
      if (seatResize.handle === 'right' || seatResize.handle === 'bottom-right') {
        newCols = Math.max(1, Math.min(80, Math.round(
          (seatResize.startTotalW + deltaX - seatResize.paddingLeft - seatResize.paddingRight + seatResize.gapX) / seatResize.stepX
        )));
      }
      if (seatResize.handle === 'bottom' || seatResize.handle === 'bottom-right') {
        newRows = Math.max(1, Math.min(50, Math.round(
          (seatResize.startTotalH + deltaY - seatResize.paddingTop - seatResize.paddingBottom + seatResize.gapY) / seatResize.stepY
        )));
      }
      if (newRows !== seatResize.lastCommittedRows || newCols !== seatResize.lastCommittedCols) {
        seatResize.lastCommittedRows = newRows;
        seatResize.lastCommittedCols = newCols;
        updateSeatGroup(seatResize.groupId, { rows: newRows, columns: newCols });
      }
      return;
    }

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
  }

  function handleStageMouseUp(event: Konva.KonvaEventObject<MouseEvent>) {
    if (seatGroupResizeRef.current) {
      seatGroupResizeRef.current = null;
      if (containerRef.current) containerRef.current.style.cursor = '';
      return;
    }

    if (marqueeDraft && tool === 'select') {
      const point = getPointerPoint() ?? marqueeDraft.current;
      const box = normalizeBoundsRect(marqueeDraft.start, point);
      setMarqueeDraft(null);

      if (box.width >= 4 || box.height >= 4) {
        const items = expandObjectSelectionItems(findItemsInMarquee(box, levelObjects, levelSeats), levelObjects);
        setSelection(items.length > 0 ? items : level ? [{ type: 'level', id: level.id }] : []);
      } else {
        setSelection(level ? [{ type: 'level', id: level.id }] : []);
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
  }

  const handleNodeDragStart = useCallback(
    (nodeId: string, item?: MapSelectionItem) => {
      clearGuides();
      const currentState = useEventMapEditorStore.getState();
      const currentSelection = currentState.selection;
      const currentObjects =
        currentState.map?.objects.filter((object) => object.levelId === activeLevelId && !object.hidden) ?? levelObjects;
      const dragTarget = resolveDragTarget(nodeId, item, currentSelection, currentObjects);
      const draggedSeat = item?.type === 'seat' ? currentState.map?.seats.find((seat) => seat.id === item.id) : null;
      const shouldDragSeatSection =
        item?.type === 'seat' &&
        item.id !== individualSeatDragId &&
        Boolean(draggedSeat?.sectionId);
      const sectionNodeIds =
        item?.type === 'section'
          ? getSectionGroupNodeIds(item.id)
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? getSectionGroupNodeIds(draggedSeat.sectionId)
            : [];
      const resolvedNodeIds = sectionNodeIds.length > 0 ? sectionNodeIds : dragTarget.nodeIds;
      const resolvedSelectionItems =
        item?.type === 'section'
          ? [item]
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? [{ type: 'section' as const, id: draggedSeat.sectionId }]
            : dragTarget.selectionItems;
      const selectableSelection = getSelectableItems(currentSelection);
      const selectionChanged =
        resolvedSelectionItems.length !== selectableSelection.length ||
        !resolvedSelectionItems.every((entry) => isItemSelected(currentSelection, entry));

      if (selectionChanged) {
        setSelection(resolvedSelectionItems);
      }

      beginGroupDrag(nodeId, resolvedNodeIds);

      const corridorIds = new Set(
        (currentState.map?.objects ?? [])
          .filter((object) => object.type === 'CORRIDOR')
          .map((object) => object.id),
      );
      const draggingCorridorIds = resolvedNodeIds
        .map((id) => id.replace(/^node-/, ''))
        .filter((id) => corridorIds.has(id));

      if (draggingCorridorIds.length > 0) {
        const base = currentState.map ? cloneEventMap(currentState.map) : null;
        corridorPreviewBaseMapRef.current = base;
        corridorPreviewWorkingMapRef.current = base ? cloneEventMap(base) : null;
        corridorDragCorridorNodeIdsRef.current = draggingCorridorIds.map((id) => `node-${id}`);
        isCorridorLivePreviewRef.current = true;
        setActiveUnionDragIds(new Set(draggingCorridorIds));

        const drag = groupDragRef.current;
        if (base && drag) {
          corridorDragModeRef.current = resolveCorridorDragMode(base, drag, draggingCorridorIds);
        }
      }
    },
    [activeLevelId, beginGroupDrag, clearGuides, getSectionGroupNodeIds, individualSeatDragId, levelObjects, setSelection],
  );

  const handleNodeDragEnd = useCallback(
    (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => {
      clearGuides();

      const drag = groupDragRef.current;
      if (drag?.origin.has(nodeId)) {
        if (corridorPreviewBaseMapRef.current) {
          syncGroupDrag(event);
          flushCorridorDragPreview();
        }
        commitGroupDrag();
        return;
      }

      if (committedGroupDragNodeIdsRef.current.has(nodeId)) {
        committedGroupDragNodeIdsRef.current.delete(nodeId);
        clearSmartCorridorPreview();
        return;
      }

      groupDragRef.current = null;
      const entityId = nodeId.replace('node-', '');
      const nx = event.target.x();
      const ny = event.target.y();
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        groupDragRef.current = null;
        clearSmartCorridorPreview();
        return;
      }
      const last = lastTransformCommitRef.current.get(entityId);
      if (last && Math.abs(last.x - nx) < 0.5 && Math.abs(last.y - ny) < 0.5) {
        lastTransformCommitRef.current.delete(entityId);
        clearSmartCorridorPreview();
        return;
      }
      onCommit(nx, ny);
      clearSmartCorridorPreview();
    },
    [clearGuides, clearSmartCorridorPreview, commitGroupDrag, flushCorridorDragPreview, syncGroupDrag],
  );

  function handleStageDragMove(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target.getStage();
    if (!stage || event.target !== stage) return;
    setPan({ x: stage.x(), y: stage.y() });
  }

  function handleStageDragEnd(event: Konva.KonvaEventObject<DragEvent>) {
    const stage = event.target.getStage();
    if (!stage || event.target !== stage) return;
    setIsPanning(false);
    setPan({ x: stage.x(), y: stage.y() });
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    setZoom(zoom + direction * 0.08);
  }

  function openTextEditor(object: EventMapObjectDTO, node: Konva.Text) {
    if (readOnly) return;
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;

    const textMode = getTextMode(object);
    textEditSnapshotRef.current = String(object.data.text ?? '');

    const groupItems = resolveGroupSelectionItem({ type: 'object', id: object.id }, levelObjects);
    setSelection(groupItems.length > 1 ? groupItems : replaceSelection({ type: 'object', id: object.id }));
    setInlineTextEditorActive(true);
    setTextEditor(
      buildTextEditorState({
        objectId: object.id,
        value: String(object.data.text ?? ''),
        mapX: object.x,
        mapY: object.y,
        mapWidth: typeof object.width === 'number' ? object.width : null,
        mapHeight: typeof object.height === 'number' ? object.height : null,
        textMode,
        rotation: object.rotation ?? 0,
        baseFontSize: Number(object.data.fontSize ?? 22),
        fontFamily: String(object.data.fontFamily ?? 'Inter, sans-serif'),
        fontWeight: String(object.data.fontWeight ?? 'normal'),
        letterSpacing: Number(object.data.letterSpacing ?? 0),
        color: String(object.data.fill ?? '#0f172a'),
        lineHeight: Number(object.data.lineHeight ?? 1.2),
        textAlign: String(object.data.align ?? 'left') as TextEditorState['textAlign'],
        stage,
        container,
        zoom,
        pan,
        node,
      }),
    );
  }

  function openNewTextEditor(box: {
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    textMode: TextMode;
  }) {
    const stage = stageRef.current;
    const container = containerRef.current;
    if (!stage || !container) return;

    textEditSnapshotRef.current = null;
    setSelection([]);
    setInlineTextEditorActive(true);
    setTextEditor(
      buildTextEditorState({
        objectId: null,
        value: '',
        mapX: box.x,
        mapY: box.y,
        mapWidth: box.width,
        mapHeight: box.height,
        textMode: box.textMode,
        rotation: 0,
        baseFontSize: 22,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 'normal',
        letterSpacing: 0,
        color: '#0f172a',
        lineHeight: 1.2,
        textAlign: 'left',
        stage,
        container,
        zoom,
        pan,
      }),
    );
  }

  function commitTextEditor() {
    if (!textEditor) return;
    if (!textEditor.value.trim()) {
      if (textEditor.objectId) deleteObject(textEditor.objectId);
      setInlineTextEditorActive(false);
      setTextEditor(null);
      return;
    }

    const dims = getTextDimensionsForMode(textEditor.textMode, textEditor.mapWidth, textEditor.mapHeight);
    const nextData = normalizeTextData({
      text: textEditor.value,
      label: textEditor.value,
      textMode: textEditor.textMode,
      fontSize: textEditor.baseFontSize,
      fontFamily: textEditor.fontFamily,
      fill: textEditor.color,
      lineHeight: textEditor.lineHeight,
      align: textEditor.textAlign,
    });

    if (!textEditor.objectId) {
      const createdId = addObjectAt(
        'text',
        { x: textEditor.mapX, y: textEditor.mapY },
        textEditor.textMode === 'auto'
          ? undefined
          : textEditor.textMode === 'fixed-width'
            ? { width: dims.width ?? 160 }
            : { width: dims.width ?? 160, height: dims.height ?? 60 },
      );
      if (!createdId) {
        setInlineTextEditorActive(false);
        setTextEditor(null);
        return;
      }
      updateObject(createdId, {
        width: dims.width,
        height: dims.height,
        data: nextData,
      });
      setInlineTextEditorActive(false);
      setTextEditor(null);
      return;
    }

    updateObject(textEditor.objectId, {
      width: dims.width,
      height: dims.height,
      data: {
        ...(map?.objects.find((object) => object.id === textEditor.objectId)?.data ?? {}),
        ...nextData,
      },
    });
    setInlineTextEditorActive(false);
    setTextEditor(null);
  }

  function renderCreationPreview() {
    if (!creationDraft) return null;
    const box = getCreationBox(creationDraft);
    if (box.width < 2 || box.height < 2) return null;

    if (creationDraft.tool === 'text') {
      return (
        <>
          <Rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill="rgba(109, 40, 217, 0.06)"
            stroke="#6d28d9"
            strokeWidth={1.5}
            dash={[6, 4]}
            listening={false}
          />
          <Text
            x={box.x + 8}
            y={box.y + 8}
            text="Texto"
            fontSize={14}
            fill="#6d28d9"
            listening={false}
          />
        </>
      );
    }

    const shape = getCreationShape(creationDraft.tool);
    const stroke = '#6d28d9';
    const fill = 'rgba(109, 40, 217, 0.08)';

    if (shape === 'circle' || shape === 'ellipse') {
      return (
        <Ellipse
          x={box.x + box.width / 2}
          y={box.y + box.height / 2}
          radiusX={box.width / 2}
          radiusY={box.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      );
    }

    if (shape === 'triangle') {
      return (
        <RegularPolygon
          x={box.x + box.width / 2}
          y={box.y + box.height / 2}
          sides={3}
          radius={Math.min(box.width, box.height) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          dash={[6, 4]}
          rotation={30}
          listening={false}
        />
      );
    }

    return <Rect x={box.x} y={box.y} width={box.width} height={box.height} fill={fill} stroke={stroke} strokeWidth={1.5} dash={[6, 4]} listening={false} />;
  }

  const placementToolActive = isPlacementTool(tool);

  const cursor =
    tool === 'zoom'
      ? isZoomScrubbing
        ? 'grabbing'
        : 'zoom-in'
      : tool === 'pan'
        ? isPanning
          ? 'grabbing'
          : 'grab'
        : tool === 'text'
          ? 'text'
          : isCreationTool(tool) || tool === 'row'
            ? 'crosshair'
            : 'default';

  function renderMarqueePreview() {
    if (!marqueeDraft) return null;
    const box = normalizeBoundsRect(marqueeDraft.start, marqueeDraft.current);
    if (box.width < 2 && box.height < 2) return null;

    return (
      <Rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="rgba(37, 99, 235, 0.08)"
        stroke="#2563eb"
        strokeWidth={1}
        dash={[4, 4]}
        listening={false}
      />
    );
  }

  function handleTransformEnd(object: EventMapObjectDTO, node: Konva.Node) {
    if (
      useUniformGroupTransform ||
      useGenericTransform ||
      (object.type === 'CORRIDOR' && useCorridorTransformerPipeline)
    ) {
      node.scaleX(1);
      node.scaleY(1);
      return;
    }

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
      node.scaleX(1);
      node.scaleY(1);
      return;
    }

    if (object.type === 'TEXT') {
      const mode = getTextMode(object);
      const anchor = transformerRef.current?.getActiveAnchor() ?? '';
      const currentFontSize = Number(object.data.fontSize ?? 22);
      node.scaleX(1);
      node.scaleY(1);
      const x = node.x();
      const y = node.y();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      lastTransformCommitRef.current.set(object.id, { x, y });
      const rotation = node.rotation();

      if (mode === 'auto' || isCornerResizeAnchor(anchor) || !anchor) {
        const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
        updateObject(object.id, {
          x,
          y,
          width: null,
          height: null,
          rotation,
          data: {
            ...object.data,
            textMode: 'auto',
            fontSize: clampFontSize(currentFontSize * uniformScale),
          },
        });
        return;
      }

      if (mode === 'fixed-width') {
        if (isHorizontalResizeAnchor(anchor)) {
          updateObject(object.id, {
            x,
            y,
            width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
            height: null,
            rotation,
            data: { ...object.data, textMode: 'fixed-width' },
          });
          return;
        }

        const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
        updateObject(object.id, {
          x,
          y,
          width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
          height: null,
          rotation,
          data: {
            ...object.data,
            textMode: 'fixed-width',
            fontSize: clampFontSize(currentFontSize * uniformScale),
          },
        });
        return;
      }

      if (isHorizontalResizeAnchor(anchor)) {
        updateObject(object.id, {
          x,
          y,
          width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
          height: object.height,
          rotation,
          data: { ...object.data, textMode: 'area' },
        });
        return;
      }

      if (isVerticalResizeAnchor(anchor)) {
        updateObject(object.id, {
          x,
          y,
          width: object.width,
          height: Math.max(MIN_OBJECT_SIZE, (object.height ?? node.height() ?? 60) * scaleY),
          rotation,
          data: { ...object.data, textMode: 'area' },
        });
        return;
      }

      const uniformScale = Math.max(Math.abs(scaleY), Math.abs(scaleX));
      updateObject(object.id, {
        x,
        y,
        width: Math.max(MIN_OBJECT_SIZE, (object.width ?? node.width() ?? 160) * scaleX),
        height: Math.max(MIN_OBJECT_SIZE, (object.height ?? node.height() ?? 60) * scaleY),
        rotation,
        data: {
          ...object.data,
          textMode: 'area',
          fontSize: clampFontSize(currentFontSize * uniformScale),
        },
      });
      return;
    }

    const nextWidth = Math.max(MIN_OBJECT_SIZE, (object.width ?? 100) * scaleX);
    const nextHeight = Math.max(MIN_OBJECT_SIZE, (object.height ?? 60) * scaleY);
    node.scaleX(1);
    node.scaleY(1);
    const x = node.x();
    const y = node.y();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
      return;
    }
    lastTransformCommitRef.current.set(object.id, { x, y });
    updateObject(object.id, {
      x,
      y,
      width: nextWidth,
      height: nextHeight,
      rotation: node.rotation(),
    });
  }

  function renderSeatGridPreview() {
    if (!seatGridDraft || seatGridPreviewSeats.length === 0) return null;

    const bounds = getSeatGridPreviewBounds(seatGridPreviewSeats, SEAT_GRID_SECTION_PADDING);

    return (
      <Group listening={false}>
        {bounds ? (
          <Rect
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            cornerRadius={10}
            fill="rgba(124, 58, 237, 0.05)"
            stroke="#7c3aed"
            strokeWidth={1}
            strokeScaleEnabled={false}
            dash={[6, 6]}
          />
        ) : null}
        {seatGridPreviewSeats.map((seat) => {
          const radius = seat.size / 2;
          return (
            <Group key={`${seat.rowIndex}-${seat.columnIndex}`} x={seat.x} y={seat.y} opacity={0.78}>
              <Circle radius={radius} fill="#7c3aed" stroke="#ffffff" strokeWidth={2} strokeScaleEnabled={false} />
              <Text
                x={-radius}
                y={-6}
                width={radius * 2}
                align="center"
                text={seat.displayLabel}
                fontSize={Math.max(8, radius * 0.55)}
                fill="#ffffff"
                fontStyle="bold"
                listening={false}
              />
            </Group>
          );
        })}
      </Group>
    );
  }

  function renderSeatGroups() {
    if (levelSeatGroups.length === 0) return null;
    return levelSeatGroups.map((group) => {
      const groupSeats = levelSeats.filter((s) => s.groupId === group.id);
      const isGroupSelected = isItemSelected(selection, { type: 'seatgroup', id: group.id });
      const stepX = group.seatWidth + group.gapX;
      const stepY = group.seatHeight + group.gapY;
      const totalW = group.paddingLeft + group.columns * stepX - group.gapX + group.paddingRight;
      const totalH = group.paddingTop + group.rows * stepY - group.gapY + group.paddingBottom;

      return (
        <Group
          key={group.id}
          id={`node-seatgroup-${group.id}`}
          x={group.x}
          y={group.y}
          rotation={group.rotation}
          listening={!placementToolActive}
          draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !group.locked}
          onClick={(event) => {
            event.cancelBubble = true;
            handleSelectItem({ type: 'seatgroup', id: group.id }, event);
          }}
          onDragMove={handleResponsiveDragMove}
          onDragEnd={(event) => {
            const nx = event.target.x();
            const ny = event.target.y();
            if (Number.isFinite(nx) && Number.isFinite(ny)) {
              updateSeatGroup(group.id, { x: nx, y: ny });
            }
          }}
        >
          {/* Group bounds indicator */}
          <Rect
            x={0}
            y={0}
            width={totalW}
            height={totalH}
            fill={isGroupSelected ? 'rgba(37,99,235,0.06)' : 'transparent'}
            stroke={isGroupSelected ? '#2563eb' : '#7c3aed'}
            strokeWidth={isGroupSelected ? 1.5 : 1}
            strokeScaleEnabled={false}
            dash={isGroupSelected ? undefined : [6, 4]}
            cornerRadius={6}
            listening={false}
          />
          {/* Group name label */}
          {group.name ? (
            <Text
              x={0}
              y={-18}
              text={group.name}
              fontSize={11}
              fill={isGroupSelected ? '#2563eb' : '#7c3aed'}
              fontStyle="500"
              listening={false}
            />
          ) : null}
          {/* Resize handles */}
          {isGroupSelected && !readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' ? (
            <>
              {/* Right handle — adjusts columns */}
              <Rect
                x={totalW - 5 / zoom}
                y={totalH / 2 - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                fill="white"
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                cornerRadius={2}
                hitStrokeWidth={6}
                onMouseEnter={() => { if (containerRef.current) containerRef.current.style.cursor = 'ew-resize'; }}
                onMouseLeave={() => { if (containerRef.current) containerRef.current.style.cursor = ''; }}
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                  const pt = getPointerPoint();
                  if (!pt) return;
                  seatGroupResizeRef.current = {
                    groupId: group.id, handle: 'right',
                    startWorldPt: pt, startRows: group.rows, startColumns: group.columns,
                    startTotalW: totalW, startTotalH: totalH,
                    stepX, stepY,
                    paddingLeft: group.paddingLeft, paddingRight: group.paddingRight,
                    paddingTop: group.paddingTop, paddingBottom: group.paddingBottom,
                    gapX: group.gapX, gapY: group.gapY,
                    lastCommittedRows: group.rows, lastCommittedCols: group.columns,
                  };
                }}
              />
              {/* Bottom handle — adjusts rows */}
              <Rect
                x={totalW / 2 - 5 / zoom}
                y={totalH - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                fill="white"
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                cornerRadius={2}
                hitStrokeWidth={6}
                onMouseEnter={() => { if (containerRef.current) containerRef.current.style.cursor = 'ns-resize'; }}
                onMouseLeave={() => { if (containerRef.current) containerRef.current.style.cursor = ''; }}
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                  const pt = getPointerPoint();
                  if (!pt) return;
                  seatGroupResizeRef.current = {
                    groupId: group.id, handle: 'bottom',
                    startWorldPt: pt, startRows: group.rows, startColumns: group.columns,
                    startTotalW: totalW, startTotalH: totalH,
                    stepX, stepY,
                    paddingLeft: group.paddingLeft, paddingRight: group.paddingRight,
                    paddingTop: group.paddingTop, paddingBottom: group.paddingBottom,
                    gapX: group.gapX, gapY: group.gapY,
                    lastCommittedRows: group.rows, lastCommittedCols: group.columns,
                  };
                }}
              />
              {/* Bottom-right handle — adjusts columns and rows */}
              <Rect
                x={totalW - 5 / zoom}
                y={totalH - 5 / zoom}
                width={10 / zoom}
                height={10 / zoom}
                fill="white"
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                cornerRadius={2}
                hitStrokeWidth={6}
                onMouseEnter={() => { if (containerRef.current) containerRef.current.style.cursor = 'nwse-resize'; }}
                onMouseLeave={() => { if (containerRef.current) containerRef.current.style.cursor = ''; }}
                onMouseDown={(event) => {
                  event.cancelBubble = true;
                  const pt = getPointerPoint();
                  if (!pt) return;
                  seatGroupResizeRef.current = {
                    groupId: group.id, handle: 'bottom-right',
                    startWorldPt: pt, startRows: group.rows, startColumns: group.columns,
                    startTotalW: totalW, startTotalH: totalH,
                    stepX, stepY,
                    paddingLeft: group.paddingLeft, paddingRight: group.paddingRight,
                    paddingTop: group.paddingTop, paddingBottom: group.paddingBottom,
                    gapX: group.gapX, gapY: group.gapY,
                    lastCommittedRows: group.rows, lastCommittedCols: group.columns,
                  };
                }}
              />
            </>
          ) : null}
          {/* Seats */}
          {groupSeats.map((seat) => {
            const radius = group.seatWidth / 2;
            // Convert world-space seat center (may include corridor displacement) to
            // seatGroup-local space by applying the inverse rotation of the group.
            const rotRad = -((group.rotation ?? 0) * Math.PI) / 180;
            const cosR = Math.cos(rotRad);
            const sinR = Math.sin(rotRad);
            const dx = seat.x - group.x;
            const dy = seat.y - group.y;
            const seatLocalX = dx * cosR - dy * sinR;
            const seatLocalY = dx * sinR + dy * cosR;
            const seatSelected = isItemSelected(selection, { type: 'seat', id: seat.id });
            return (
              <Group
                key={seat.id}
                id={`node-${seat.id}`}
                x={seatLocalX}
                y={seatLocalY}
                listening={!placementToolActive}
                onClick={(event) => {
                  event.cancelBubble = true;
                  handleSelectItem({ type: 'seatgroup', id: group.id }, event);
                }}
              >
                <Circle
                  radius={radius}
                  fill={seatFill(seat.status)}
                  stroke={isGroupSelected || seatSelected ? '#1d4ed8' : '#ffffff'}
                  strokeWidth={isGroupSelected || seatSelected ? 3 : 2}
                  strokeScaleEnabled={false}
                />
                <Text
                  x={-radius}
                  y={-6}
                  width={radius * 2}
                  align="center"
                  text={seat.displayLabel}
                  fontSize={Math.max(9, radius * 0.65)}
                  fill="#ffffff"
                  fontStyle="bold"
                  listening={false}
                />
              </Group>
            );
          })}
        </Group>
      );
    });
  }

  if (!map || !level) {
    return <div ref={containerRef} className="h-full min-h-0 flex-1 bg-slate-100" />;
  }

  const textEditorDimensions = textEditor
    ? getTextEditorDimensions({
        textMode: textEditor.textMode,
        value: textEditor.value,
        fontSize: textEditor.fontSize,
        fontFamily: textEditor.fontFamily,
        fontWeight: textEditor.fontWeight,
        letterSpacing: textEditor.letterSpacing,
        lineHeight: textEditor.lineHeight,
        width: textEditor.width,
        height: textEditor.height,
        minHeight: textEditor.minHeight,
      })
    : null;

  return (
    <div
      ref={containerRef}
      data-testid="map-canvas"
      className={`relative h-full min-h-0 flex-1 overflow-hidden bg-[#f8fafc]${tool === 'zoom' ? ' select-none' : ''}`}
      style={{ cursor }}
    >
      {textEditor ? (
        <textarea
          data-testid="map-text-editor"
          ref={textEditorRef}
          value={textEditor.value}
          onChange={(event) => {
            const value = event.target.value;
            setTextEditor((current) => (current ? { ...current, value } : current));
          }}
          onBlur={commitTextEditor}
          placeholder={textEditor.value ? undefined : TEXT_EDITOR_PLACEHOLDER}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              if (textEditor.objectId && textEditSnapshotRef.current !== null) {
                updateObject(textEditor.objectId, {
                  data: {
                    ...(map?.objects.find((object) => object.id === textEditor.objectId)?.data ?? {}),
                    text: textEditSnapshotRef.current,
                    label: textEditSnapshotRef.current,
                  },
                });
              }
              setInlineTextEditorActive(false);
              setTextEditor(null);
              return;
            }
            if (textEditor.textMode === 'auto' && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commitTextEditor();
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              commitTextEditor();
            }
          }}
          style={{
            left: textEditor.left,
            top: textEditor.top,
            width: textEditorDimensions?.width,
            height: textEditorDimensions?.height,
            minHeight: textEditor.minHeight,
            fontSize: textEditor.fontSize,
            fontFamily: textEditor.fontFamily,
            fontWeight: textEditor.fontWeight === 'bold' ? 700 : 400,
            letterSpacing: textEditor.letterSpacing,
            lineHeight: textEditor.lineHeight,
            color: textEditor.color,
            textAlign: textEditor.textAlign,
            transform: textEditor.transform,
            transformOrigin: 'left top',
            whiteSpace: textEditor.textMode === 'auto' ? 'pre' : 'pre-wrap',
          }}
          wrap={textEditor.textMode === 'auto' ? 'off' : 'soft'}
          rows={1}
          className="absolute z-30 resize-none overflow-hidden whitespace-pre border-0 bg-transparent p-0 outline-none ring-0"
        />
      ) : null}
      {seatGridDraft ? (
        <CreateSeatGridDialog
          config={seatGridDraft.config}
          onChange={(config) => setSeatGridDraft((draft) => (draft ? { ...draft, config } : draft))}
          onCancel={() => setSeatGridDraft(null)}
          onConfirm={() => {
            addSeatGridAt(seatGridDraft.origin, seatGridDraft.config);
            setSeatGridDraft(null);
          }}
        />
      ) : null}
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={pan.x}
        y={pan.y}
        scaleX={zoom}
        scaleY={zoom}
        draggable={!readOnly && tool === 'pan'}
        onDragStart={(event) => {
          if (event.target === event.target.getStage()) setIsPanning(true);
        }}
        onDragMove={handleStageDragMove}
        onDragEnd={handleStageDragEnd}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onWheel={handleWheel}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={level.widthPx} height={level.heightPx} fill="#ffffff" stroke="#cbd5e1" strokeWidth={2} />
        </Layer>

        <Layer ref={contentLayerRef}>
          {corridorUnionGroups.map((group) => {
            if (group.objectIds.length < 2) return null;

            return (
              <Group key={`corridor-union-${group.id}`} listening={false}>
                {group.mergedPolygons.map((polygon, index) => (
                  <Line
                    key={`${group.id}-merged-${index}`}
                    points={polygonToKonvaPoints(polygon)}
                    closed
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                    strokeWidth={1.5}
                    strokeScaleEnabled={false}
                    dash={[8, 6]}
                    listening={false}
                  />
                ))}
              </Group>
            );
          })}

          {displayLevelObjects.map((object) => {
            // SECTION objects for seatgroups are visually represented by renderSeatGroups().
            if (object.type === 'SECTION' && object.sectionId != null && seatGroupSectionIds.has(object.sectionId)) {
              return null;
            }
            const appearance = getObjectAppearance(object);
            const width = object.width ?? 180;
            const height = object.height ?? 90;
            const shape = typeof object.data.shape === 'string' ? object.data.shape : null;
            const selected = isObjectSelected(object, selection, levelObjects);
            const opacity = Number(object.data.opacity ?? (object.type === 'SECTION' ? 0.15 : 1));
            const cornerRadius = Number(object.data.cornerRadius ?? (object.type === 'TABLE' ? 999 : shape ? 0 : 8));

            if (object.type === 'CORRIDOR') {
              const corridorProps = buildCorridorMapObjectProps(object, {
                selection,
                levelObjects,
                selectedCorridorIds,
                corridorUnionGroups,
                activeUnionDragIds,
                isObjectSelected: (entry) => isObjectSelected(entry, selection, levelObjects),
              });
              const freezeFromReact = isTransformSessionActive && selectedCorridorIds.has(object.id);

              return (
                <CorridorMapObject
                  key={object.id}
                  {...corridorProps}
                  freezeFromReact={freezeFromReact}
                  placementToolActive={placementToolActive}
                  readOnly={readOnly}
                  tool={tool}
                  onSelect={(event) => handleSelectItem({ type: 'object', id: object.id }, event)}
                  onDragStart={() => handleNodeDragStart(`node-${object.id}`, { type: 'object', id: object.id })}
                  onDragMove={handleResponsiveDragMove}
                  onDragEnd={(event) =>
                    handleNodeDragEnd(`node-${object.id}`, event, (x, y) => updateObject(object.id, { x, y }))
                  }
                  onTransformEnd={() => undefined}
                />
              );
            }

            if (object.type === 'TEXT') {
              const textMode = getTextMode(object);
              const textStrokeWidth = Number(object.data.strokeWidth ?? 0);
              const textStroke = String(object.data.stroke ?? '#000000');
              const textWidth = isTextBoxMode(object) ? object.width ?? undefined : undefined;
              const hasCustomHeight = textMode === 'area' && typeof object.height === 'number' && object.height > 0;
              const fontSize = clampFontSizeValue(Number(object.data.fontSize ?? 22));
              const lineHeight = Number(object.data.lineHeight ?? 1.2);
              return (
                <Text
                  key={object.id}
                  id={`node-${object.id}`}
                  x={object.x}
                  y={object.y}
                  scaleX={1}
                  scaleY={1}
                  text={String(object.data.text ?? 'Texto')}
                  width={textWidth}
                  height={hasCustomHeight ? object.height ?? undefined : undefined}
                  fontFamily={String(object.data.fontFamily ?? 'Inter, sans-serif')}
                  fontSize={fontSize}
                  fontStyle={buildTextFontStyle(object.data)}
                  textDecoration={getKonvaTextDecoration(object.data)}
                  align={String(object.data.align ?? 'left') as Konva.TextConfig['align']}
                  verticalAlign={String(object.data.verticalAlign ?? 'top') as Konva.TextConfig['verticalAlign']}
                  lineHeight={lineHeight}
                  letterSpacing={Number(object.data.letterSpacing ?? 0)}
                  fill={String(object.data.fill ?? '#0f172a')}
                  opacity={Number(object.data.opacity ?? 1)}
                  stroke={textStrokeWidth > 0 ? textStroke : undefined}
                  strokeWidth={textStrokeWidth}
                  strokeScaleEnabled={false}
                  wrap={getTextWrap(textMode)}
                  rotation={object.rotation}
                  name={SNAP_TARGET_NAME}
                  listening={!placementToolActive}
                  draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !object.locked}
                  onClick={(event) => handleSelectItem({ type: 'object', id: object.id }, event)}
                  onDblClick={(event) => {
                    event.cancelBubble = true;
                    openTextEditor(object, event.target as Konva.Text);
                  }}
                  visible={textEditor?.objectId !== object.id}
                  onDragStart={() => handleNodeDragStart(`node-${object.id}`, { type: 'object', id: object.id })}
                  onDragMove={handleResponsiveDragMove}
                  onDragEnd={(event) =>
                    handleNodeDragEnd(`node-${object.id}`, event, (x, y) => updateObject(object.id, { x, y }))
                  }
                  onTransformEnd={(event) => {
                    if (isSingleSelectionTransform) handleTransformEnd(object, event.target);
                  }}
                />
              );
            }

            return (
              <Group
                key={object.id}
                id={`node-${object.id}`}
                x={object.x}
                y={object.y}
                scaleX={1}
                scaleY={1}
                rotation={object.rotation}
                offsetX={0}
                offsetY={0}
                name={SNAP_TARGET_NAME}
                listening={!placementToolActive}
                draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !object.locked}
                onClick={(event) =>
                  handleSelectItem(
                    object.sectionId ? { type: 'section', id: object.sectionId } : { type: 'object', id: object.id },
                    event,
                  )
                }
                onDragStart={() =>
                  handleNodeDragStart(
                    `node-${object.id}`,
                    object.sectionId ? { type: 'section', id: object.sectionId } : { type: 'object', id: object.id },
                  )
                }
                onDragMove={handleResponsiveDragMove}
                onDragEnd={(event) =>
                  handleNodeDragEnd(`node-${object.id}`, event, (x, y) => updateObject(object.id, { x, y }))
                }
                onTransformEnd={(event) => {
                  if (isSingleSelectionTransform) {
                    handleTransformEnd(object, event.target);
                  }
                }}
              >
                {shape === 'circle' || shape === 'ellipse' ? (
                  <Ellipse
                    x={width / 2}
                    y={height / 2}
                    radiusX={width / 2}
                    radiusY={height / 2}
                    fill={appearance.fill}
                    opacity={opacity}
                    stroke={appearance.stroke}
                    strokeWidth={appearance.strokeWidth}
                    strokeScaleEnabled={false}
                    dash={appearance.dash}
                  />
                ) : shape === 'triangle' ? (
                  <RegularPolygon
                    x={width / 2}
                    y={height / 2}
                    sides={3}
                    radius={Math.min(width, height) / 2}
                    fill={appearance.fill}
                    opacity={opacity}
                    stroke={appearance.stroke}
                    strokeWidth={appearance.strokeWidth}
                    strokeScaleEnabled={false}
                    dash={appearance.dash}
                    rotation={30}
                  />
                ) : (
                  <Rect
                    width={width}
                    height={height}
                    cornerRadius={cornerRadius}
                    fill={appearance.fill}
                    opacity={opacity}
                    stroke={appearance.stroke}
                    strokeWidth={appearance.strokeWidth}
                    strokeScaleEnabled={false}
                    dash={appearance.dash}
                  />
                )}
                {selected ? (
                  <Rect
                    width={width}
                    height={height}
                    fill="transparent"
                    stroke="#2563eb"
                    strokeWidth={1.5}
                    strokeScaleEnabled={false}
                    dash={[4, 4]}
                    listening={false}
                  />
                ) : null}
              </Group>
            );
          })}

          {renderSeatGroups()}

          {levelSeats.map((seat) => {
            // Grouped seats are rendered inside renderSeatGroups()
            if (seat.groupId != null) return null;
            const selected = isItemSelected(selection, { type: 'seat', id: seat.id });
            const radius = (seat.size ?? 24) / 2;
            return (
              <Group
                key={seat.id}
                id={`node-${seat.id}`}
                x={seat.x}
                y={seat.y}
                rotation={seat.rotation}
                name={SNAP_TARGET_NAME}
                listening={!placementToolActive}
                draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && seat.status !== 'SOLD'}
                onClick={(event) => handleSelectItem({ type: 'seat', id: seat.id }, event)}
                onDblClick={(event) => {
                  event.cancelBubble = true;
                  setIndividualSeatDragId(seat.id);
                  setSelection(replaceSelection({ type: 'seat', id: seat.id }));
                }}
                onDragStart={() => handleNodeDragStart(`node-${seat.id}`, { type: 'seat', id: seat.id })}
                onDragMove={handleResponsiveDragMove}
                onDragEnd={(event) =>
                  handleNodeDragEnd(`node-${seat.id}`, event, (x, y) => updateSeat(seat.id, { x, y }))
                }
              >
                <Circle radius={radius} fill={seatFill(seat.status)} stroke={selected ? '#1d4ed8' : '#ffffff'} strokeWidth={selected ? 4 : 2} />
                <Text
                  x={-radius}
                  y={-6}
                  width={radius * 2}
                  align="center"
                  text={seat.displayLabel}
                  fontSize={Math.max(9, radius * 0.65)}
                  fill="#ffffff"
                  fontStyle="bold"
                  listening={false}
                />
              </Group>
            );
          })}

          {renderSeatGridPreview()}

          <Transformer
            ref={transformerRef}
            rotateEnabled={!disableRotateForMixedSmartCorridorSelection}
            resizeEnabled={!disableResizeForMixedSmartCorridorSelection}
            keepRatio={transformerScaleOptions.keepRatio}
            centeredScaling={transformerScaleOptions.centeredScaling}
            flipEnabled={false}
            enabledAnchors={
              disableResizeForMixedSmartCorridorSelection ? [] : selectedTextTransformAnchors
            }
            listening={!placementToolActive}
            anchorDragBoundFunc={(_oldAbs, newAbs, event) => {
              if (
                readOnly ||
                tool === 'pan' ||
                tool === 'zoom' ||
                transformPipelineActive ||
                !levelBounds
              ) {
                return newAbs;
              }

              const transformer = transformerRef.current;
              const anchor = transformer?.getActiveAnchor() ?? '';
              if (!anchor || anchor === 'rotater') {
                return newAbs;
              }

              const contentLayer = transformer?.getLayer();
              if (!contentLayer) {
                return newAbs;
              }

              const nodes = transformer?.nodes() ?? [];
              const referenceBox =
                nodes.length === 1
                  ? getNodeBounds(nodes[0])
                  : computeUnionBoundsFromNodes(nodes);

              return handleAnchorDragBound(newAbs, {
                anchor,
                contentLayer,
                skipIds: selectedNodeIds,
                referenceBox,
                snapDisabled: isSnapModifierActive(event),
              });
            }}
            boundBoxFunc={(oldBox, newBox) => {
              if (Math.abs(newBox.width) < MIN_OBJECT_SIZE || Math.abs(newBox.height) < MIN_OBJECT_SIZE) {
                return oldBox;
              }
              return newBox;
            }}
          />
          {renderCreationPreview()}
          {renderMarqueePreview()}
          <SnapGuidesLayer ref={guidesLayerRef} zoom={zoom} />
        </Layer>
      </Stage>
    </div>
  );
}
