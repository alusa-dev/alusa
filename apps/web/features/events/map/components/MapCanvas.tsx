'use client';

import type { EventMapDTO } from '../api/event-map-service';
import type { LevelBounds, MapSelection, SeatBlockConfig } from '@alusa/domain';
import { findMapBlockOwner, findMapRowOwner, replaceSelection } from '@alusa/domain';
import {
  isPlacementTool,
  type CreationDraft,
  type MarqueeDraft,
  type SeatCreationMode,
  getCreationBox,
  getSeatBlockConfigForBounds,
} from '../canvas/render/map-creation-draft';
import type { MapTransformSession } from '../canvas/transform/map-transform-session';
import { DEFAULT_TRANSFORMER_SCALE_OPTIONS } from '../canvas/transform/transform-handle-mode';
import type { TransformerScaleOptions } from '../canvas/transform/transform-handle-mode';
import { setEventMapE2ERenderMapProvider } from '../browser/event-map-e2e-bridge';
import { resolveTransformRouting } from '../canvas/transform/transform-routing';
import type { TransformNodeSnapshot } from '../canvas/adapters/konva-transform-adapter';
import type { TextEditorState } from '../canvas/render/text-editor-layout';
import {
  resolveMapCanvasCursor,
  useCanvasViewportSize,
  useMapStageViewportHandlers,
  useZoomScrubSession,
} from '../canvas/sessions/use-canvas-viewport-session';
import { applyCanvasTransformPayload } from '../canvas/commit/apply-canvas-transform';
import { buildObjectTransformCommit } from '../canvas/commit/map-object-transform-commit';
import {
  buildMapCanvasRenderHandlers,
  buildMapCanvasRenderState,
  buildTextEditorOverlayDimensions,
  getMapPointerPoint,
} from '../canvas/render/map-canvas-render-model';
import { useDragSession } from '../canvas/sessions/use-drag-session';
import { useKeyboardSession } from '../canvas/sessions/use-keyboard-session';
import { useMapCanvasStore } from '../canvas/sessions/use-map-canvas-store';
import { useMapLevelViewModel } from '../canvas/sessions/use-map-level-view-model';
import { useMapNodeDragSession } from '../canvas/sessions/use-map-node-drag-session';
import { useMapStagePointerSession } from '../canvas/sessions/use-map-stage-pointer-session';
import { useMapTextEditorCommit } from '../canvas/sessions/use-map-text-editor-commit';
import { useMapTextEditorOpen } from '../canvas/sessions/use-map-text-editor-open';
import { useMapTransformRouting } from '../canvas/sessions/use-map-transform-routing';
import { useSelectionSession } from '../canvas/sessions/use-selection-session';
import { useSnapGuidesSession } from '../canvas/sessions/use-snap-guides-session';
import { useTextEditorSession } from '../canvas/sessions/use-text-editor-session';
import { useTransformSession } from '../canvas/sessions/use-transform-session';
import type { EventMapObjectDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import { MapCanvasStage } from './MapCanvasStage';
import { MapInlineTextEditor } from './MapInlineTextEditor';

import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';

function getInheritedSeatBlockDefaults(
  map: EventMapDTO | null,
  levelId: string | undefined,
  selection: MapSelection,
): Pick<SeatBlockConfig, 'seatSize' | 'horizontalSpacing' | 'verticalSpacing'> | undefined {
  const document = map?.document;
  if (!document) return undefined;

  const selected = selection.length === 1 ? selection[0] : undefined;
  const selectedBlock = selected?.type === 'seatblock'
    ? findMapBlockOwner(document, selected.id)
    : selected?.type === 'seatrow'
      ? findMapRowOwner(document, selected.id)
      : null;
  const block = selectedBlock?.block ?? document.sections
    .filter((section) => section.levelId === levelId)
    .flatMap((section) => section.blocks)
    .at(-1);
  if (!block) return undefined;

  const firstRow = block.rows[0];
  const seatSize = firstRow?.seatSize ?? 28;
  return {
    seatSize,
    horizontalSpacing: seatSize + (firstRow?.seatGap ?? block.defaultSeatGap),
    verticalSpacing: seatSize + block.rowGap,
  };
}

export function MapCanvas({ readOnly, seatCreationMode, referenceChartEditing, onReferenceChartTransformCommit }: { readOnly: boolean; seatCreationMode: SeatCreationMode; referenceChartEditing: boolean; onReferenceChartTransformCommit: (transform: import('@alusa/domain').MapReferenceTransform) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const contentLayerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [individualSeatDragId, setIndividualSeatDragId] = useState<string | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<MarqueeDraft | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditorFocusKeyRef = useRef<string | null>(null);
  const textEditSnapshotRef = useRef<string | null>(null);
  const mapTransformSessionRef = useRef<MapTransformSession | null>(null);
  const transformCancelSnapshotsRef = useRef<TransformNodeSnapshot[]>([]);
  const transformCancelledRef = useRef(false);
  const transformContextRef = useRef({
    selectedObjectIds: [] as string[],
    selectedSeatIds: [] as string[],
    selectedNodeIds: [] as string[],
    transformKind: null as ReturnType<typeof resolveTransformRouting>['kind'],
    selectedParametricItem: null as MapSelection[number] | null,
    selectedParametricItems: [] as Extract<MapSelection[number], { type: 'seatblock' | 'seatrow' }>[],
    levelBounds: null as LevelBounds | null,
  });
  const [isTransformSessionActive, setIsTransformSessionActive] = useState(false);
  const [transformerScaleOptions, setTransformerScaleOptions] = useState<TransformerScaleOptions>(
    DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  );
  const lastTransformCommitRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const { groupDragRef, committedGroupDragNodeIdsRef, beginGroupDrag, syncGroupDrag } = useDragSession({ stageRef });

  const store = useMapCanvasStore();
  const {
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
    deleteObject,
    updateSeat,
    setInlineTextEditorActive,
    setViewportSize,
  } = store;

  const { commitTextEditor, handleTextEditorKeyDown } = useMapTextEditorCommit({
    textEditor,
    textEditSnapshotRef,
    map,
    setTextEditor,
    setInlineTextEditorActive,
    addObjectAt,
    updateObject,
    deleteObject,
  });

  const getPointerPoint = useCallback(
    () => getMapPointerPoint(stageRef, pan, zoom),
    [pan, zoom],
  );

  const seatBlockDraft =
    map && creationDraft?.tool === 'seat'
      ? getSeatBlockConfigForBounds(
          getCreationBox(creationDraft),
          map.referenceChart?.calibration,
          Math.max(1, map.seats.length + 1),
          getInheritedSeatBlockDefaults(map, activeLevelId ?? undefined, selection),
        )
      : null;

  const levelView = useMapLevelViewModel({
    map,
    activeLevelId,
    seatBlockDraft,
  });

  const {
    level,
    levelBounds,
    levelObjects,
    displayLevelObjects,
    levelSeats,
    renderStack,
    seatBlockPreviewSeats,
  } = levelView;

  const size = useCanvasViewportSize({ containerRef, setViewportSize });
  const isZoomScrubbing = useZoomScrubSession({ enabled: tool === 'zoom', containerRef, stageRef, setZoom, setPan });

  useEffect(() => {
    if (tool !== 'seat' || readOnly) setCreationDraft((draft) => (draft?.tool === 'seat' ? null : draft));
  }, [readOnly, tool]);

  useTextEditorSession({
    textEditor,
    setTextEditor,
    textEditorRef,
    textEditorFocusKeyRef,
    stageRef,
    containerRef,
    zoom,
    pan,
  });

  const selectionSession = useSelectionSession({
    map,
    selection,
    levelObjects,
    levelSeats,
    setSelection,
    clearIndividualSeatDrag: () => setIndividualSeatDragId(null),
  });

  const {
    selectedNodeIds,
    selectedObjectIds,
    selectedSeatIds,
    selectionContainsSeatsOrSections,
    handleSelectItem,
    getMarqueeSelection,
    isObjectSelected,
  } = selectionSession;

  useEffect(() => {
    setEventMapE2ERenderMapProvider(() => useEventMapEditorStore.getState().map);
    return () => setEventMapE2ERenderMapProvider(null);
  }, []);

  const transformRouting = useMapTransformRouting({
    map,
    levelObjects,
    selectedNodeIds,
    selectedObjectIds,
    selectedSeatIds,
    selectionContainsSeatsOrSections,
    selection,
    levelBounds,
    transformContextRef,
  });

  const ascendSelection = useEventMapEditorStore((state) => state.ascendSelection);

  useKeyboardSession({
    stageRef,
    transformerRef,
    transformContextRef,
    isTransformSessionActive,
    mapTransformSessionRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    ascendSelection,
  });

  useTransformSession({
    stageRef,
    contentLayerRef,
    transformerRef,
    transformPipelineActive: transformRouting.transformPipelineActive,
    map,
    levelId: level?.id,
    levelObjects,
    selectedNodeIds,
    transformContextRef,
    mapTransformSessionRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    lastTransformCommitRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
  });

  const snapSession = useSnapGuidesSession({
    enabled: !readOnly && tool !== 'pan',
    levelBounds,
    zoom,
    groupDragRef,
    syncGroupDrag,
  });

  const nodeDrag = useMapNodeDragSession({
    activeLevelId,
    transformerRef,
    levelObjects,
    levelSeats,
    map,
    groupDragRef,
    committedGroupDragNodeIdsRef,
    beginGroupDrag,
    syncGroupDrag,
    lastTransformCommitRef,
    setSelection,
    individualSeatDragId,
    clearGuides: snapSession.clearGuides,
    handleSnapDragMove: snapSession.handleDragMove,
  });

  const { openTextEditor, openNewTextEditor } = useMapTextEditorOpen({
    readOnly,
    textEditSnapshotRef,
    stageRef,
    containerRef,
    zoom,
    pan,
    levelObjects,
    tool,
    textEditor,
    setSelection,
    setInlineTextEditorActive,
    setTextEditor,
  });

  const stagePointer = useMapStagePointerSession({
    readOnly,
    tool,
    map,
    levelId: level?.id,
    zoom,
    getPointerPoint,
    addObjectAt,
    addRowAt,
    addSeatBlockAt,
    seatBlockDefaults: getInheritedSeatBlockDefaults(map, level?.id, selection),
    setSelection,
    setIndividualSeatDragId,
    getMarqueeSelection,
    openNewTextEditor,
    creationDraft,
    setCreationDraft,
    marqueeDraft,
    setMarqueeDraft,
  });

  const viewportHandlers = useMapStageViewportHandlers({ setPan, setZoom, zoom, pan, setIsPanning });

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const onTransformStart = () => snapSession.clearGuides();
    const onTransformEnd = () => snapSession.clearGuides();
    transformer.on('transformstart', onTransformStart);
    transformer.on('transformend', onTransformEnd);
    return () => {
      transformer.off('transformstart', onTransformStart);
      transformer.off('transformend', onTransformEnd);
    };
  }, [snapSession.clearGuides]);

  const handleTransformEnd = useCallback(
    (object: EventMapObjectDTO, node: Konva.Node) => {
      applyCanvasTransformPayload(
        buildObjectTransformCommit({
          object,
          node,
          transformer: transformerRef.current,
          routing: {
            useUniformGroupTransform: transformRouting.useUniformGroupTransform,
            useGenericTransform: transformRouting.useGenericTransform,
          },
          lastTransformCommitRef,
        }),
      );
    },
    [
      transformRouting.useGenericTransform,
      transformRouting.useUniformGroupTransform,
    ],
  );

  const placementToolActive = isPlacementTool(tool);
  const cursor = resolveMapCanvasCursor({ tool, isPanning, isZoomScrubbing });

  if (!map || !level) {
    return <div ref={containerRef} className="h-full min-h-0 flex-1 bg-slate-100" />;
  }

  const canvasRenderState = buildMapCanvasRenderState({
    renderStack,
    document: map.document,
    displayLevelObjects,
    levelSeats,
    selection,
    levelObjects,
    textEditorObjectId: textEditor?.objectId ?? null,
    placementToolActive,
    readOnly,
    tool,
    zoom,
    isTransformSessionActive,
    isSingleSelectionTransform: transformRouting.isSingleSelectionTransform,
    containerRef,
    getPointerPoint,
  });

  const canvasRenderHandlers = buildMapCanvasRenderHandlers({
    isObjectSelected,
    onSelect: (event, item) => handleSelectItem(item, event),
    onDoubleClickSelectIndividualSeat: (seatId) => {
      setIndividualSeatDragId(seatId);
      setSelection(replaceSelection({ type: 'seat', id: seatId }));
    },
    onDragStart: nodeDrag.handleNodeDragStart,
    onDragMove: nodeDrag.handleResponsiveDragMove,
    onDragEnd: nodeDrag.handleNodeDragEnd,
    onObjectTransformEnd: handleTransformEnd,
    onUpdateObjectPosition: (objectId, x, y) => updateObject(objectId, { x, y }),
    onUpdateSeatPosition: (seatId, x, y) => updateSeat(seatId, { x, y }),
    onOpenTextEditor: openTextEditor,
  });

  const textEditorDimensions = buildTextEditorOverlayDimensions(textEditor);

  return (
    <div
      ref={containerRef}
      data-testid="map-canvas"
      className={`relative h-full min-h-0 flex-1 overflow-hidden bg-[#f8fafc]${tool === 'zoom' ? ' select-none' : ''}`}
      style={{ cursor }}
    >
      {textEditor ? (
        <MapInlineTextEditor
          textEditor={textEditor}
          textEditorRef={textEditorRef}
          textEditorDimensions={textEditorDimensions}
          onChange={(value) => setTextEditor((current) => (current ? { ...current, value } : current))}
          onBlur={commitTextEditor}
          onKeyDown={handleTextEditorKeyDown}
        />
      ) : null}
      <MapCanvasStage
        stageRef={stageRef}
        contentLayerRef={contentLayerRef}
        guidesLayerRef={snapSession.guidesLayerRef}
        transformerRef={transformerRef}
        size={size}
        level={level}
        levelId={level.id}
        pan={pan}
        zoom={zoom}
        readOnly={readOnly}
        tool={tool}
        renderState={canvasRenderState}
        renderHandlers={canvasRenderHandlers}
        creationDraft={creationDraft}
        marqueeDraft={marqueeDraft}
        seatBlockDraft={seatBlockDraft}
        seatBlockPreviewSeats={seatBlockPreviewSeats}
        referenceChart={map.referenceChart}
        referenceChartEditing={referenceChartEditing}
        onReferenceChartTransformCommit={onReferenceChartTransformCommit}
        transformDisabled={transformRouting.transformDisabled}
        transformerScaleOptions={transformerScaleOptions}
        selectedTextTransformAnchors={transformRouting.selectedTextTransformAnchors}
        placementToolActive={placementToolActive}
        levelBounds={levelBounds}
        selectedNodeIds={selectedNodeIds}
        handleAnchorDragBound={snapSession.handleAnchorDragBound}
        onStagePanStart={viewportHandlers.handleStagePanStart}
        onStageDragMove={viewportHandlers.handleStageDragMove}
        onStageDragEnd={viewportHandlers.handleStageDragEnd}
        onMouseDown={stagePointer.handleStageMouseDown}
        onMouseMove={stagePointer.handleStageMouseMove}
        onMouseUp={stagePointer.handleStageMouseUp}
        onClick={stagePointer.handleStageClick}
        onWheel={viewportHandlers.handleWheel}
      />
    </div>
  );
}
