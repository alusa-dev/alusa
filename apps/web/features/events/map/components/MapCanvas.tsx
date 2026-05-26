'use client';

import type { LevelBounds } from '@alusa/domain';
import { replaceSelection } from '@alusa/domain';
import { isPlacementTool, type CreationDraft, type MarqueeDraft, type SeatGridDraft } from '../canvas/render/map-creation-draft';
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
import { buildSeatGroupTransformCommit } from '../canvas/commit/seat-group-transform-commit';
import {
  buildMapCanvasRenderHandlers,
  buildMapCanvasRenderState,
  buildTextEditorOverlayDimensions,
  getMapPointerPoint,
} from '../canvas/render/map-canvas-render-model';
import { useCorridorPreviewSession } from '../canvas/sessions/use-corridor-preview-session';
import { useDragSession } from '../canvas/sessions/use-drag-session';
import { useKeyboardSession } from '../canvas/sessions/use-keyboard-session';
import { useMapCanvasStore } from '../canvas/sessions/use-map-canvas-store';
import { useMapLevelViewModel } from '../canvas/sessions/use-map-level-view-model';
import { useMapNodeDragSession } from '../canvas/sessions/use-map-node-drag-session';
import { useMapStagePointerSession } from '../canvas/sessions/use-map-stage-pointer-session';
import { useMapTextEditorCommit } from '../canvas/sessions/use-map-text-editor-commit';
import { useMapTextEditorOpen } from '../canvas/sessions/use-map-text-editor-open';
import { useMapTransformRouting } from '../canvas/sessions/use-map-transform-routing';
import { useSeatGroupResizeSession } from '../canvas/sessions/use-seat-group-resize-session';
import { useSelectionSession } from '../canvas/sessions/use-selection-session';
import { useSnapGuidesSession } from '../canvas/sessions/use-snap-guides-session';
import { useTextEditorSession } from '../canvas/sessions/use-text-editor-session';
import { useTransformSession } from '../canvas/sessions/use-transform-session';
import type { EventMapObjectDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';
import { CreateSeatGridDialog } from './CreateSeatGridDialog';
import { MapCanvasStage } from './MapCanvasStage';
import { MapInlineTextEditor } from './MapInlineTextEditor';

import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';

export function MapCanvas({ readOnly }: { readOnly: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const contentLayerRef = useRef<Konva.Layer | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [seatGridDraft, setSeatGridDraft] = useState<SeatGridDraft | null>(null);
  const [individualSeatDragId, setIndividualSeatDragId] = useState<string | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<MarqueeDraft | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditorFocusKeyRef = useRef<string | null>(null);
  const textEditSnapshotRef = useRef<string | null>(null);
  const mapTransformSessionRef = useRef<MapTransformSession | null>(null);
  const transformReflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformCancelSnapshotsRef = useRef<TransformNodeSnapshot[]>([]);
  const transformCancelledRef = useRef(false);
  const transformContextRef = useRef({
    selectedObjectIds: [] as string[],
    selectedSeatIds: [] as string[],
    selectedSeatGroupIds: [] as string[],
    selectedNodeIds: [] as string[],
    transformKind: null as ReturnType<typeof resolveTransformRouting>['kind'],
    levelBounds: null as LevelBounds | null,
  });
  const [isTransformSessionActive, setIsTransformSessionActive] = useState(false);
  const [transformerScaleOptions, setTransformerScaleOptions] = useState<TransformerScaleOptions>(
    DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  );
  const [corridorVisualRevision, setCorridorVisualRevision] = useState(0);
  const [activeUnionDragIds, setActiveUnionDragIds] = useState<Set<string>>(() => new Set());
  const lastTransformCommitRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const { groupDragRef, committedGroupDragNodeIdsRef, beginGroupDrag, syncGroupDrag } = useDragSession({ stageRef });
  const bumpCorridorVisualRevision = useCallback(() => setCorridorVisualRevision((value) => value + 1), []);
  const corridorPreview = useCorridorPreviewSession({
    stageRef,
    contentLayerRef,
    groupDragRef,
    mapTransformSessionRef,
    transformReflowTimerRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    setActiveUnionDragIds,
    bumpCorridorVisualRevision,
  });

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
    addSeatGridAt,
    updateObject,
    deleteObject,
    updateSeat,
    updateSeatGroup,
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

  const { beginSeatGroupResize, handleSeatGroupResizeMove, endSeatGroupResize } = useSeatGroupResizeSession({
    containerRef,
    getPointerPoint,
    updateSeatGroup,
  });

  const levelView = useMapLevelViewModel({
    map,
    activeLevelId,
    selection,
    seatGridDraft,
    stageRef,
    isCorridorLivePreviewRef: corridorPreview.isCorridorLivePreviewRef,
    isTransformSessionActive,
    corridorVisualRevision,
  });

  const {
    level,
    levelBounds,
    levelObjects,
    displayLevelObjects,
    levelSeats,
    levelSeatGroups,
    corridorUnionGroups,
    renderStack,
    selectedCorridorIds,
    seatGridPreviewSeats,
  } = levelView;

  const size = useCanvasViewportSize({ containerRef, setViewportSize });
  const isZoomScrubbing = useZoomScrubSession({ enabled: tool === 'zoom', containerRef, stageRef, setZoom, setPan });

  useEffect(() => {
    if (tool !== 'seat' || readOnly) setSeatGridDraft(null);
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
    levelSeatGroups,
    setSelection,
    clearIndividualSeatDrag: () => setIndividualSeatDragId(null),
  });

  const {
    selectedNodeIds,
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
    selectionContainsSeatsOrSections,
    handleSelectItem,
    getMarqueeSelection,
    isObjectSelected,
  } = selectionSession;

  useEffect(() => {
    setEventMapE2ERenderMapProvider(
      () => corridorPreview.corridorPreviewWorkingMapRef.current ?? useEventMapEditorStore.getState().map,
    );
    return () => setEventMapE2ERenderMapProvider(null);
  }, [map, corridorPreview.corridorPreviewWorkingMapRef]);

  const transformRouting = useMapTransformRouting({
    map,
    levelObjects,
    selectedNodeIds,
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
    selectionContainsSeatsOrSections,
    levelBounds,
    transformContextRef,
  });

  useKeyboardSession({
    stageRef,
    transformerRef,
    transformContextRef,
    isTransformSessionActive,
    mapTransformSessionRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    transformReflowTimerRef,
    isCorridorTransformActiveRef: corridorPreview.isCorridorTransformActiveRef,
    corridorPreviewBaseMapRef: corridorPreview.corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef: corridorPreview.corridorPreviewWorkingMapRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    getCommittedState: useCallback(
      () => ({
        map: useEventMapEditorStore.getState().map,
        activeLevelId: useEventMapEditorStore.getState().activeLevelId,
        levelObjects,
      }),
      [levelObjects],
    ),
    bumpCorridorVisualRevision,
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
    transformReflowTimerRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    corridorPreviewBaseMapRef: corridorPreview.corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef: corridorPreview.corridorPreviewWorkingMapRef,
    isCorridorLivePreviewRef: corridorPreview.isCorridorLivePreviewRef,
    isCorridorTransformActiveRef: corridorPreview.isCorridorTransformActiveRef,
    lastTransformCommitRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    bumpCorridorVisualRevision,
  });

  const snapSession = useSnapGuidesSession({
    enabled: !readOnly && tool !== 'pan',
    levelBounds,
    zoom,
    stageRef,
    groupDragRef,
    syncGroupDrag,
  });

  const nodeDrag = useMapNodeDragSession({
    activeLevelId,
    levelObjects,
    levelSeats,
    map,
    groupDragRef,
    committedGroupDragNodeIdsRef,
    beginGroupDrag,
    syncGroupDrag,
    flushCorridorDragPreview: corridorPreview.flushCorridorDragPreview,
    clearSmartCorridorPreview: corridorPreview.clearSmartCorridorPreview,
    corridorPreviewBaseMapRef: corridorPreview.corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef: corridorPreview.corridorPreviewWorkingMapRef,
    corridorDragCorridorNodeIdsRef: corridorPreview.corridorDragCorridorNodeIdsRef,
    corridorDragModeRef: corridorPreview.corridorDragModeRef,
    isCorridorLivePreviewRef: corridorPreview.isCorridorLivePreviewRef,
    setActiveUnionDragIds,
    lastTransformCommitRef,
    setSelection,
    individualSeatDragId,
    setIndividualSeatDragId,
    clearGuides: snapSession.clearGuides,
    handleSnapDragMove: snapSession.handleDragMove,
    isSmartCorridorPreviewDrag: corridorPreview.isSmartCorridorPreviewDrag,
    scheduleCorridorDragPreview: corridorPreview.scheduleCorridorDragPreview,
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
            useCorridorTransformerPipeline: transformRouting.useCorridorTransformerPipeline,
          },
          lastTransformCommitRef,
        }),
      );
    },
    [
      transformRouting.useCorridorTransformerPipeline,
      transformRouting.useGenericTransform,
      transformRouting.useUniformGroupTransform,
    ],
  );

  const handleSeatGroupTransformEnd = useCallback(
    (group: EventSeatGroupDTO, node: Konva.Node) => {
      applyCanvasTransformPayload(buildSeatGroupTransformCommit({ group, node, lastTransformCommitRef }));
    },
    [],
  );

  const placementToolActive = isPlacementTool(tool);
  const cursor = resolveMapCanvasCursor({ tool, isPanning, isZoomScrubbing });

  if (!map || !level) {
    return <div ref={containerRef} className="h-full min-h-0 flex-1 bg-slate-100" />;
  }

  const canvasRenderState = buildMapCanvasRenderState({
    renderStack,
    displayLevelObjects,
    levelSeats,
    levelSeatGroups,
    corridorUnionGroups,
    selection,
    selectedCorridorIds,
    activeUnionDragIds,
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
    onSeatGroupTransformEnd: handleSeatGroupTransformEnd,
    onUpdateObjectPosition: (objectId, x, y) => updateObject(objectId, { x, y }),
    onUpdateSeatPosition: (seatId, x, y) => updateSeat(seatId, { x, y }),
    onUpdateSeatGroupPosition: (groupId, x, y) => updateSeatGroup(groupId, { x, y }),
    onOpenTextEditor: openTextEditor,
    onSeatGroupResizeStart: beginSeatGroupResize,
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
      <MapCanvasStage
        stageRef={stageRef}
        contentLayerRef={contentLayerRef}
        guidesLayerRef={snapSession.guidesLayerRef}
        transformerRef={transformerRef}
        size={size}
        level={level}
        pan={pan}
        zoom={zoom}
        readOnly={readOnly}
        tool={tool}
        renderState={canvasRenderState}
        renderHandlers={canvasRenderHandlers}
        creationDraft={creationDraft}
        marqueeDraft={marqueeDraft}
        seatGridDraft={seatGridDraft}
        seatGridPreviewSeats={seatGridPreviewSeats}
        disableRotateForMixedSmartCorridorSelection={transformRouting.disableRotateForMixedSmartCorridorSelection}
        disableResizeForMixedSmartCorridorSelection={transformRouting.disableResizeForMixedSmartCorridorSelection}
        transformerScaleOptions={transformerScaleOptions}
        selectedTextTransformAnchors={transformRouting.selectedTextTransformAnchors}
        placementToolActive={placementToolActive}
        transformPipelineActive={transformRouting.transformPipelineActive}
        levelBounds={levelBounds}
        selectedNodeIds={selectedNodeIds}
        handleAnchorDragBound={snapSession.handleAnchorDragBound}
        onStagePanStart={viewportHandlers.handleStagePanStart}
        onStageDragMove={viewportHandlers.handleStageDragMove}
        onStageDragEnd={viewportHandlers.handleStageDragEnd}
        onMouseDown={stagePointer.handleStageMouseDown}
        onMouseMove={stagePointer.handleStageMouseMove}
        onMouseUp={stagePointer.handleStageMouseUp}
        onWheel={viewportHandlers.handleWheel}
      />
    </div>
  );
}
