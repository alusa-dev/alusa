'use client';

import {
  CORRIDOR_REFLOW_ITERATIONS,
  buildSmartCorridorDragPreview,
  cloneEventMap,
  resolveCorridorDragMode,
} from '@alusa/domain';
import type { CorridorDragMode } from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { applyCorridorPreviewToStage, restoreCorridorStageFromMap } from '../corridor/corridor-preview-stage';
import { DEFAULT_TRANSFORMER_SCALE_OPTIONS } from '../transform/transform-handle-mode';
import type { TransformerScaleOptions } from '../transform/transform-handle-mode';
import type { MapTransformSession } from '../transform/map-transform-session';

import { useCallback, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type Konva from 'konva';

type GroupDragState = {
  anchorNodeId: string;
  origin: Map<string, { x: number; y: number }>;
  delta: { x: number; y: number };
};

type CorridorPreviewSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
  contentLayerRef: RefObject<Konva.Layer | null>;
  groupDragRef: MutableRefObject<GroupDragState | null>;
  mapTransformSessionRef: MutableRefObject<MapTransformSession | null>;
  transformReflowTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setIsTransformSessionActive: (active: boolean) => void;
  setTransformerScaleOptions: (options: TransformerScaleOptions) => void;
  setActiveUnionDragIds: (ids: Set<string>) => void;
  bumpCorridorVisualRevision: () => void;
};

export function useCorridorPreviewSession({
  stageRef,
  contentLayerRef,
  groupDragRef,
  mapTransformSessionRef,
  transformReflowTimerRef,
  setIsTransformSessionActive,
  setTransformerScaleOptions,
  setActiveUnionDragIds,
  bumpCorridorVisualRevision,
}: CorridorPreviewSessionInput) {
  const corridorPreviewBaseMapRef = useRef<EventMapDTO | null>(null);
  const corridorPreviewWorkingMapRef = useRef<EventMapDTO | null>(null);
  const corridorPreviewRafRef = useRef<number | null>(null);
  const corridorDragCorridorNodeIdsRef = useRef<string[]>([]);
  const corridorDragModeRef = useRef<CorridorDragMode>('reflow');
  const isCorridorLivePreviewRef = useRef(false);
  const isCorridorTransformActiveRef = useRef(false);

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
  }, [
    bumpCorridorVisualRevision,
    cancelCorridorPreviewFrame,
    contentLayerRef,
    mapTransformSessionRef,
    setActiveUnionDragIds,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    stageRef,
    transformReflowTimerRef,
  ]);

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
  }, [bumpCorridorVisualRevision, contentLayerRef, groupDragRef, stageRef]);

  const scheduleCorridorDragPreview = useCallback(() => {
    if (corridorPreviewRafRef.current !== null) return;
    corridorPreviewRafRef.current = requestAnimationFrame(runCorridorDragPreviewFrame);
  }, [runCorridorDragPreviewFrame]);

  const flushCorridorDragPreview = useCallback(() => {
    cancelCorridorPreviewFrame();
    runCorridorDragPreviewFrame();
  }, [cancelCorridorPreviewFrame, runCorridorDragPreviewFrame]);

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
  }, [groupDragRef]);

  return {
    corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef,
    corridorDragCorridorNodeIdsRef,
    corridorDragModeRef,
    isCorridorLivePreviewRef,
    isCorridorTransformActiveRef,
    clearSmartCorridorPreview,
    scheduleCorridorDragPreview,
    flushCorridorDragPreview,
    isSmartCorridorPreviewDrag,
  };
}
