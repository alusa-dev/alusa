'use client';

import type { MutableRefObject, RefObject } from 'react';
import { useEffect } from 'react';
import type Konva from 'konva';
import { resetMapTransformTransformer, restoreParametricLivePreview } from '../transform/map-transform-session';
import type { MapTransformSession } from '../transform/map-transform-session';
import { restoreTransformNodeSnapshots, type TransformNodeSnapshot } from '../adapters/konva-transform-adapter';
import { DEFAULT_TRANSFORMER_SCALE_OPTIONS, resolveGenericTransformerScaleOptions } from '../transform/transform-handle-mode';
import type { TransformerScaleOptions } from '../transform/transform-handle-mode';

type TransformContextRef = MutableRefObject<{
  selectedNodeIds: string[];
  transformKind: 'uniform' | 'generic' | 'parametric' | null;
}>;

type KeyboardSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  transformContextRef: TransformContextRef;
  isTransformSessionActive: boolean;
  mapTransformSessionRef: MutableRefObject<MapTransformSession | null>;
  transformCancelSnapshotsRef: MutableRefObject<TransformNodeSnapshot[]>;
  transformCancelledRef: MutableRefObject<boolean>;
  setIsTransformSessionActive: (active: boolean) => void;
  setTransformerScaleOptions: (options: TransformerScaleOptions) => void;
  ascendSelection: () => boolean;
};

const ROTATION_SNAPS_15 = Array.from({ length: 24 }, (_, index) => index * 15);

export function useKeyboardSession({
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
}: KeyboardSessionInput) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const transformer = transformerRef.current;
      if (!transformer || event.key !== 'Shift') return;
      transformer.rotationSnaps(event.type === 'keydown' ? ROTATION_SNAPS_15 : []);
      transformer.rotationSnapTolerance(event.type === 'keydown' ? 7 : 5);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [transformerRef]);

  useEffect(() => {
    if (isTransformSessionActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (!ascendSelection()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ascendSelection, isTransformSessionActive]);

  useEffect(() => {
    if (!isTransformSessionActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const stage = stageRef.current;
      const transformer = transformerRef.current;
      const snapshots = transformCancelSnapshotsRef.current;
      if (!stage || !transformer || snapshots.length === 0) return;
      event.preventDefault();
      transformCancelledRef.current = true;
      restoreTransformNodeSnapshots(stage, snapshots);
      const session = mapTransformSessionRef.current;
      if (session) {
        restoreParametricLivePreview(session, stage);
        resetMapTransformTransformer(session, transformer);
      }
      mapTransformSessionRef.current = null;
      transformCancelSnapshotsRef.current = [];
      setIsTransformSessionActive(false);
      setTransformerScaleOptions(DEFAULT_TRANSFORMER_SCALE_OPTIONS);
      const nodes = transformContextRef.current.selectedNodeIds
        .map((nodeId) => stage.findOne(`#${nodeId}`))
        .filter((node): node is Konva.Node => Boolean(node));
      transformer.nodes(nodes);
      transformer.getLayer()?.batchDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    isTransformSessionActive,
    mapTransformSessionRef,
    setIsTransformSessionActive,
    setTransformerScaleOptions,
    stageRef,
    transformCancelSnapshotsRef,
    transformCancelledRef,
    transformContextRef,
    transformerRef,
  ]);

  useEffect(() => {
    if (!isTransformSessionActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Shift' || transformContextRef.current.transformKind !== 'generic') return;
      setTransformerScaleOptions(resolveGenericTransformerScaleOptions(event.type === 'keydown'));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [isTransformSessionActive, setTransformerScaleOptions, transformContextRef]);
}
