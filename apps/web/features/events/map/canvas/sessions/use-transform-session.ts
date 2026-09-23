'use client';

import { shortestRotationDelta, type EventMapDTO, type EventMapObjectDTO } from '@alusa/domain';
import type { LevelBounds } from '@alusa/domain';
import type { MutableRefObject, RefObject } from 'react';
import { useEffect } from 'react';
import type Konva from 'konva';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { applyCanvasTransformCommit, applyCanvasTransformPayload } from '../commit/apply-canvas-transform';
import {
  applyMapTransformLivePreview,
  beginMapTransformSession,
  buildMapTransformCommit,
  isSemanticGenericRotation,
  resetParametricPreviewScales,
  resetMapTransformTransformer,
  type MapTransformSession,
} from '../transform/map-transform-session';
import {
  captureTransformNodeSnapshots,
  resetNodeScale,
  type TransformNodeSnapshot,
} from '../adapters/konva-transform-adapter';
import {
  DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  resolveGenericTransformerScaleOptions,
  resolveUniformTransformerScaleOptions,
  type TransformerScaleOptions,
} from '../transform/transform-handle-mode';

type TransformContextRef = MutableRefObject<{
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedNodeIds: string[];
  selectedParametricItem: import('@alusa/domain').MapSelectionItem | null;
  selectedParametricItems: Array<Extract<import('@alusa/domain').MapSelectionItem, { type: 'seatblock' | 'seatrow' }>>;
  transformKind: import('../transform/transform-routing').MapTransformRoutingKind;
  levelBounds: LevelBounds | null;
}>;

type TransformSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
  contentLayerRef: RefObject<Konva.Layer | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  transformPipelineActive: boolean;
  map: EventMapDTO | null;
  levelId: string | null | undefined;
  levelObjects: EventMapObjectDTO[];
  selectedNodeIds: string[];
  transformContextRef: TransformContextRef;
  mapTransformSessionRef: MutableRefObject<MapTransformSession | null>;
  transformCancelSnapshotsRef: MutableRefObject<TransformNodeSnapshot[]>;
  transformCancelledRef: MutableRefObject<boolean>;
  lastTransformCommitRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  setIsTransformSessionActive: (active: boolean) => void;
  setTransformerScaleOptions: (options: TransformerScaleOptions) => void;
};

function buildRotationSelection(session: MapTransformSession) {
  return [
    ...session.selectedObjectIds.map((id) => ({ type: 'object' as const, id })),
    ...session.selectedSeatIds.map((id) => ({ type: 'seat' as const, id })),
  ];
}

export function useTransformSession(input: TransformSessionInput) {
  const {
    stageRef,
    contentLayerRef,
    transformerRef,
    transformPipelineActive,
    map,
    levelId,
    levelObjects,
    selectedNodeIds,
    transformContextRef,
    mapTransformSessionRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    lastTransformCommitRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
  } = input;

  useEffect(() => {
    const transformer = transformerRef.current!;
    const stage = stageRef.current!;
    if (!transformer || !stage || !transformPipelineActive || !map) return;

    function onTransformStart() {
      transformCancelledRef.current = false;
      const context = transformContextRef.current;
      const kind = context.transformKind;
      const currentMap = useEventMapEditorStore.getState().map;
      if (!kind || !currentMap) return;

      transformCancelSnapshotsRef.current = captureTransformNodeSnapshots(stage, context.selectedNodeIds);
      setIsTransformSessionActive(true);
      setTransformerScaleOptions(
        kind === 'uniform' || kind === 'parametric'
          ? resolveUniformTransformerScaleOptions()
          : resolveGenericTransformerScaleOptions(false),
      );

      const session = beginMapTransformSession({
        kind,
        map: currentMap,
        selectedObjectIds: context.selectedObjectIds,
        selectedSeatIds: context.selectedSeatIds,
        parametricItems: context.selectedParametricItems,
        stage,
        transformer,
      });
      if (session) mapTransformSessionRef.current = session;
    }

    function onTransform() {
      const session = mapTransformSessionRef.current;
      if (!session) return;
      applyMapTransformLivePreview(session, { stage, transformer });
      transformer.getLayer()?.batchDraw();
    }

    function onTransformEnd() {
      const session = mapTransformSessionRef.current;
      const currentMap = useEventMapEditorStore.getState().map;
      if (!session || !currentMap) return;

      if (transformCancelledRef.current) {
        transformCancelledRef.current = false;
        mapTransformSessionRef.current = null;
        setIsTransformSessionActive(false);
        return;
      }

      if (session.parametricItems.length > 0 && session.initialParametricTransforms.size > 0) {
        const transforms = session.parametricItems.flatMap((item) => {
          const initial = session.initialParametricTransforms.get(`${item.type}:${item.id}`);
          const node = stage.findOne(`#node-${item.type}-${item.id}`);
          if (!initial || !node) return [];
          const values = node.getTransform().copy().multiply(initial.copy().invert()).getMatrix();
          node.position({ x: 0, y: 0 });
          node.rotation(0);
          node.scale({ x: 1, y: 1 });
          node.getLayer()?.batchDraw();
          return [{ item, matrix: values as [number, number, number, number, number, number] }];
        });
        useEventMapEditorStore.getState().transformParametricSelections(transforms);
        resetParametricPreviewScales(session, stage);
        resetMapTransformTransformer(session, transformer);
        mapTransformSessionRef.current = null;
        transformCancelSnapshotsRef.current = [];
        setIsTransformSessionActive(false);
        setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);
        contentLayerRef.current?.batchDraw();
        return;
      }

      if (isSemanticGenericRotation(session)) {
        for (const nodeId of session.selectedObjectIds.concat(session.selectedSeatIds)) {
          const node = stage.findOne(`#node-${nodeId}`) ?? stage.findOne(`#${nodeId}`);
          if (node) resetNodeScale(node);
        }
        const angleDelta = shortestRotationDelta(session.initialTransformerRotation, transformer.rotation());
        applyCanvasTransformCommit({
          type: 'ROTATE_SELECTION',
          payload: { selection: buildRotationSelection(session), angleDelta, mode: 'free' },
        });
      } else {
        const commit = buildMapTransformCommit(session, { stage, transformer }, currentMap);
        for (const entry of commit.objectUpdates) {
          lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
        }
        for (const entry of commit.seatUpdates) {
          lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
        }
        if (commit.objectUpdates.length || commit.seatUpdates.length) {
          applyCanvasTransformPayload({
            objects: commit.objectUpdates,
            seats: commit.seatUpdates,
          });
        }
      }

      resetMapTransformTransformer(session, transformer);
      mapTransformSessionRef.current = null;
      transformCancelSnapshotsRef.current = [];
      setIsTransformSessionActive(false);
      setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);
      const context = transformContextRef.current;
      transformer.nodes(
        context.selectedNodeIds
          .map((nodeId) => stage.findOne(`#${nodeId}`))
          .filter((node): node is Konva.Node => Boolean(node)),
      );
      contentLayerRef.current?.batchDraw();
    }

    transformer.on('transformstart', onTransformStart);
    transformer.on('transform', onTransform);
    transformer.on('transformend', onTransformEnd);
    return () => {
      transformer.off('transformstart', onTransformStart);
      transformer.off('transform', onTransform);
      transformer.off('transformend', onTransformEnd);
      mapTransformSessionRef.current = null;
    };
  }, [
    contentLayerRef,
    lastTransformCommitRef,
    map,
    mapTransformSessionRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    stageRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    transformContextRef,
    transformPipelineActive,
    transformerRef,
  ]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!stage || !transformer || !levelId) return;
    const nodes = selectedNodeIds
      .map((nodeId) => stage.findOne(`#${nodeId}`))
      .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
    contentLayerRef.current?.batchDraw();
  }, [contentLayerRef, levelId, levelObjects, selectedNodeIds, stageRef, transformerRef]);
}
