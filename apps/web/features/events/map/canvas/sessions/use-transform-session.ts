'use client';

import {
  CORRIDOR_REFLOW_ITERATIONS,
  buildSmartCorridorTransformPreview,
  cloneEventMap,
  extractCorridorDragCommitUpdates,
  getObjectBounds,
} from '@alusa/domain';
import type { LevelBounds } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { buildCorridorTransformCommitPatches } from '../corridor-transform-session';
import { corridorPatchesToDomainOperations } from '../corridor-domain-transform-bridge';
import { recordCorridorDomainOperations } from '../event-map-e2e-bridge';
import {
  applyMapTransformLivePreview,
  beginMapTransformSession,
  buildMapTransformCommit,
  resetMapTransformTransformer,
} from '../map-transform-session';
import type { MapTransformSession } from '../map-transform-session';
import { applyCorridorPreviewToStage } from '../corridor-preview-stage';
import { syncCorridorNodesFromMap } from '../corridor-canvas';
import { captureTransformNodeSnapshots } from '../transform-cancel';
import type { TransformNodeSnapshot } from '../transform-cancel';
import {
  DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  resolveCorridorTransformerScaleOptions,
  resolveGenericTransformerScaleOptions,
  resolveUniformTransformerScaleOptions,
} from '../transform-handle-mode';
import type { TransformerScaleOptions } from '../transform-handle-mode';

import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type Konva from 'konva';

type TransformKind = 'uniform' | 'corridor' | 'generic' | null;

type TransformContextRef = MutableRefObject<{
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
  selectedNodeIds: string[];
  transformKind: TransformKind;
  levelBounds: LevelBounds | null;
}>;

type ItemUpdate<TPatch> = { id: string; patch: TPatch };

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
  transformReflowTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  transformCancelSnapshotsRef: MutableRefObject<TransformNodeSnapshot[]>;
  transformCancelledRef: MutableRefObject<boolean>;
  corridorPreviewBaseMapRef: MutableRefObject<EventMapDTO | null>;
  corridorPreviewWorkingMapRef: MutableRefObject<EventMapDTO | null>;
  isCorridorLivePreviewRef: MutableRefObject<boolean>;
  isCorridorTransformActiveRef: MutableRefObject<boolean>;
  lastTransformCommitRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  setIsTransformSessionActive: (active: boolean) => void;
  setTransformerScaleOptions: (options: TransformerScaleOptions) => void;
  updateObjects: (updates: Array<ItemUpdate<Partial<EventMapObjectDTO>>>) => void;
  updateMapItems: (updates: {
    objects?: Array<ItemUpdate<Partial<EventMapObjectDTO>>>;
    seats?: Array<ItemUpdate<Partial<EventSeatDTO>>>;
    seatGroups?: Array<ItemUpdate<Partial<EventSeatGroupDTO>>>;
    skipSeatBaseLayoutTranslation?: boolean;
    skipCorridorReflow?: boolean;
  }) => void;
  bumpCorridorVisualRevision: () => void;
};

export function useTransformSession({
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
  transformReflowTimerRef,
  transformCancelSnapshotsRef,
  transformCancelledRef,
  corridorPreviewBaseMapRef,
  corridorPreviewWorkingMapRef,
  isCorridorLivePreviewRef,
  isCorridorTransformActiveRef,
  lastTransformCommitRef,
  setIsTransformSessionActive,
  setTransformerScaleOptions,
  updateObjects,
  updateMapItems,
  bumpCorridorVisualRevision,
}: TransformSessionInput) {
  useEffect(() => {
    const transformer = transformerRef.current!;
    const stage = stageRef.current!;
    if (!transformer || !stage || !transformPipelineActive || !map) return;

    function buildCorridorSnapContext() {
      const ctx = transformContextRef.current;
      const currentMap = useEventMapEditorStore.getState().map;
      if (!currentMap || !ctx.levelBounds) return undefined;

      const skipIds = new Set(ctx.selectedObjectIds);
      const objectBounds = currentMap.objects
        .filter((object) => object.levelId === levelId && !object.hidden && !skipIds.has(object.id))
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
        const activeLevelId = useEventMapEditorStore.getState().activeLevelId;
        if (!baseMap || !corridorSession || !activeLevelId) return;

        const patches = buildCorridorTransformCommitPatches(
          corridorSession,
          { stage, transformer },
          buildCorridorSnapContext(),
        );
        if (patches.length === 0) return;

        const preview = buildSmartCorridorTransformPreview(baseMap, patches, {
          previewMap: corridorPreviewWorkingMapRef.current ?? undefined,
          maxIterations: CORRIDOR_REFLOW_ITERATIONS,
          activeCorridorIds: corridorSession.corridorIds,
        });
        applyCorridorPreviewToStage(
          stage,
          preview,
          baseMap,
          corridorSession.corridorIds.map((id) => `node-${id}`),
          activeLevelId,
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

      transformCancelSnapshotsRef.current = captureTransformNodeSnapshots(stage, ctx.selectedNodeIds);

      const corridorIds = ctx.selectedObjectIds.filter((objectId) =>
        currentMap.objects.some((entry) => entry.id === objectId && entry.type === 'CORRIDOR'),
      );

      const anchor = transformer.getActiveAnchor() ?? '';

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
        selectedSeatGroupIds: ctx.selectedSeatGroupIds,
        stage,
        transformer,
      });
      if (!session) return;
      mapTransformSessionRef.current = session;
    }

    function onTransform() {
      const session = mapTransformSessionRef.current;
      if (!session) return;

      applyMapTransformLivePreview(session, {
        stage,
        transformer,
        snap: buildCorridorSnapContext(),
      });
      transformer.getLayer()?.batchDraw();
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
            { stage, transformer, snap: buildCorridorSnapContext() },
            currentMap,
          )
        : { objectUpdates: [], seatUpdates: [], seatGroupUpdates: [], corridorPatches: [] };

      for (const entry of commit.objectUpdates) {
        lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
      }
      for (const entry of commit.seatUpdates) {
        lastTransformCommitRef.current.set(entry.id, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
      }
      for (const entry of commit.seatGroupUpdates) {
        lastTransformCommitRef.current.set(`seatgroup-${entry.id}`, { x: entry.patch.x ?? 0, y: entry.patch.y ?? 0 });
      }

      if (session?.kind === 'uniform' && commit.objectUpdates.length > 0) {
        if (commit.seatGroupUpdates.length > 0 || commit.seatUpdates.length > 0) {
          updateMapItems({
            objects: commit.objectUpdates,
            seats: commit.seatUpdates,
            seatGroups: commit.seatGroupUpdates,
          });
        } else {
          updateObjects(commit.objectUpdates.map((entry) => ({ id: entry.id, patch: entry.patch })));
        }
      } else if (session?.kind === 'generic' && commit.objectUpdates.length > 0) {
        if (commit.seatGroupUpdates.length > 0 || commit.seatUpdates.length > 0) {
          updateMapItems({
            objects: commit.objectUpdates,
            seats: commit.seatUpdates,
            seatGroups: commit.seatGroupUpdates,
          });
        } else {
          updateObjects(commit.objectUpdates.map((entry) => ({ id: entry.id, patch: entry.patch })));
        }
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
            seatGroups: commit.seatGroupUpdates,
            skipSeatBaseLayoutTranslation: reflowedSeats.length > 0,
            skipCorridorReflow: corridorIds.length > 0,
          });
        } else if (commit.objectUpdates.length > 0 || commit.seatUpdates.length > 0 || commit.seatGroupUpdates.length > 0) {
          updateMapItems({ objects: commit.objectUpdates, seats: commit.seatUpdates, seatGroups: commit.seatGroupUpdates });
        }
      } else if (commit.objectUpdates.length > 0 || commit.seatUpdates.length > 0 || commit.seatGroupUpdates.length > 0) {
        updateMapItems({ objects: commit.objectUpdates, seats: commit.seatUpdates, seatGroups: commit.seatGroupUpdates });
      }

      if (session) resetMapTransformTransformer(session, transformer);

      isCorridorTransformActiveRef.current = false;
      mapTransformSessionRef.current = null;
      corridorPreviewBaseMapRef.current = null;
      corridorPreviewWorkingMapRef.current = null;
      transformCancelSnapshotsRef.current = [];
      setIsTransformSessionActive(false);
      setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);

      const activeLevelId = useEventMapEditorStore.getState().activeLevelId;
      const committedMap = useEventMapEditorStore.getState().map;
      if (committedMap && activeLevelId) {
        syncCorridorNodesFromMap(stage, committedMap.objects, activeLevelId);
      }

      const nodes = ctx.selectedNodeIds
        .map((nodeId) => stage.findOne(`#${nodeId}`))
        .filter((node): node is Konva.Node => Boolean(node));
      transformer.nodes(nodes);
      transformer.getLayer()?.batchDraw();
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
  }, [
    bumpCorridorVisualRevision,
    contentLayerRef,
    corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef,
    isCorridorTransformActiveRef,
    lastTransformCommitRef,
    levelId,
    map,
    mapTransformSessionRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    stageRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    transformContextRef,
    transformPipelineActive,
    transformReflowTimerRef,
    transformerRef,
    updateMapItems,
    updateObjects,
  ]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!stage || !levelId) return;

    if (!isCorridorLivePreviewRef.current && !isCorridorTransformActiveRef.current) {
      syncCorridorNodesFromMap(stage, levelObjects, levelId);
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
  }, [
    contentLayerRef,
    isCorridorLivePreviewRef,
    isCorridorTransformActiveRef,
    levelId,
    levelObjects,
    selectedNodeIds,
    stageRef,
    transformerRef,
  ]);
}
