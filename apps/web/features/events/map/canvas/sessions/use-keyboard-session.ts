'use client';

import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type Konva from 'konva';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { syncCorridorNodesFromMap } from '../corridor/corridor-canvas';
import { resetMapTransformTransformer } from '../transform/map-transform-session';
import type { MapTransformSession } from '../transform/map-transform-session';
import {
  captureTransformNodeSnapshots,
  restoreTransformNodeSnapshots,
  type TransformNodeSnapshot,
} from '../adapters/konva-transform-adapter';
import {
  DEFAULT_TRANSFORMER_SCALE_OPTIONS,
  resolveGenericTransformerScaleOptions,
} from '../transform/transform-handle-mode';
import type { TransformerScaleOptions } from '../transform/transform-handle-mode';

const ROTATION_SNAPS_15 = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285,
  300, 315, 330, 345,
];

type TransformContextRef = MutableRefObject<{
  selectedNodeIds: string[];
  transformKind: 'uniform' | 'corridor' | 'generic' | null;
}>;

type KeyboardSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  transformContextRef: TransformContextRef;
  isTransformSessionActive: boolean;
  mapTransformSessionRef: MutableRefObject<MapTransformSession | null>;
  transformCancelSnapshotsRef: MutableRefObject<TransformNodeSnapshot[]>;
  transformCancelledRef: MutableRefObject<boolean>;
  transformReflowTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isCorridorTransformActiveRef: MutableRefObject<boolean>;
  corridorPreviewBaseMapRef: MutableRefObject<EventMapDTO | null>;
  corridorPreviewWorkingMapRef: MutableRefObject<EventMapDTO | null>;
  setIsTransformSessionActive: (active: boolean) => void;
  setTransformerScaleOptions: (options: TransformerScaleOptions) => void;
  getCommittedState: () => { map: EventMapDTO | null; activeLevelId: string | null; levelObjects: EventMapObjectDTO[] };
  bumpCorridorVisualRevision: () => void;
};

export function useKeyboardSession({
  stageRef,
  transformerRef,
  transformContextRef,
  isTransformSessionActive,
  mapTransformSessionRef,
  transformCancelSnapshotsRef,
  transformCancelledRef,
  transformReflowTimerRef,
  isCorridorTransformActiveRef,
  corridorPreviewBaseMapRef,
  corridorPreviewWorkingMapRef,
  setIsTransformSessionActive,
  setTransformerScaleOptions,
  getCommittedState,
  bumpCorridorVisualRevision,
}: KeyboardSessionInput) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Shift') return;
      const transformer = transformerRef.current;
      if (!transformer) return;
      if (event.type === 'keydown') {
        transformer.rotationSnaps(ROTATION_SNAPS_15);
        transformer.rotationSnapTolerance(7);
      } else {
        transformer.rotationSnaps([]);
        transformer.rotationSnapTolerance(5);
      }
    }

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [transformerRef]);

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

      const { map, activeLevelId, levelObjects } = getCommittedState();
      if (map && activeLevelId) {
        syncCorridorNodesFromMap(stage, levelObjects.length > 0 ? levelObjects : map.objects, activeLevelId);
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
  }, [
    bumpCorridorVisualRevision,
    corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef,
    getCommittedState,
    isCorridorTransformActiveRef,
    isTransformSessionActive,
    mapTransformSessionRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    stageRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    transformContextRef,
    transformReflowTimerRef,
    transformerRef,
  ]);

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
  }, [isTransformSessionActive, setTransformerScaleOptions, transformContextRef]);
}
