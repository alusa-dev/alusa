import { buildShapeTransformPatch, buildTextTransformPatch } from '@alusa/domain';
import { resetNodeScale } from '../adapters/konva-transform-adapter';
import type Konva from 'konva';
import type { EventMapObjectDTO } from '../../api/event-map-service';
import type { TransformCommitPayload } from './build-canvas-transform-command';

export type ObjectTransformRoutingFlags = {
  useUniformGroupTransform: boolean;
  useGenericTransform: boolean;
  useCorridorTransformerPipeline: boolean;
};

export type BuildObjectTransformCommitParams = {
  object: EventMapObjectDTO;
  node: Konva.Node;
  transformer: Konva.Transformer | null;
  routing: ObjectTransformRoutingFlags;
  lastTransformCommitRef: { current: Map<string, { x: number; y: number }> };
};

function objectPayload(object: EventMapObjectDTO, patch: Partial<EventMapObjectDTO>): TransformCommitPayload {
  return { objects: [{ id: object.id, patch }] };
}

export function buildObjectTransformCommit({
  object,
  node,
  transformer,
  routing,
  lastTransformCommitRef,
}: BuildObjectTransformCommitParams): TransformCommitPayload | null {
  const { useUniformGroupTransform, useGenericTransform, useCorridorTransformerPipeline } = routing;

  if (
    useUniformGroupTransform ||
    useGenericTransform ||
    (object.type === 'CORRIDOR' && useCorridorTransformerPipeline)
  ) {
    resetNodeScale(node);
    return null;
  }

  const scaleX = node.scaleX();
  const scaleY = node.scaleY();

  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    resetNodeScale(node);
    return null;
  }

  if (object.type === 'TEXT') {
    resetNodeScale(node);
    const x = node.x();
    const y = node.y();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    lastTransformCommitRef.current.set(object.id, { x, y });
    const patch = buildTextTransformPatch(object, {
      scaleX,
      scaleY,
      anchor: transformer?.getActiveAnchor() ?? '',
      x,
      y,
      rotation: node.rotation(),
      nodeWidth: node.width(),
      nodeHeight: node.height(),
    });
    return objectPayload(object, patch);
  }

  resetNodeScale(node);
  const x = node.x();
  const y = node.y();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const patch = buildShapeTransformPatch(object, {
    scaleX,
    scaleY,
    x,
    y,
    rotation: node.rotation(),
  });

  if (!Number.isFinite(patch.width ?? 0) || !Number.isFinite(patch.height ?? 0)) {
    return null;
  }

  lastTransformCommitRef.current.set(object.id, { x, y });
  return objectPayload(object, patch);
}
