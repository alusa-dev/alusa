import { readSeatGroupTransformFromNode } from '../adapters/konva-transform-adapter';
import type Konva from 'konva';
import type { EventSeatGroupDTO } from '../../api/event-map-service';
import type { TransformCommitPayload } from './build-canvas-transform-command';

export type BuildSeatGroupTransformCommitParams = {
  group: EventSeatGroupDTO;
  node: Konva.Node;
  lastTransformCommitRef: { current: Map<string, { x: number; y: number }> };
};

export function buildSeatGroupTransformCommit({
  group,
  node,
  lastTransformCommitRef,
}: BuildSeatGroupTransformCommitParams): TransformCommitPayload | null {
  const patch = readSeatGroupTransformFromNode(node, group);
  if (!patch) return null;

  lastTransformCommitRef.current.set(`seatgroup-${group.id}`, { x: patch.x, y: patch.y });
  return { seatGroups: [{ id: group.id, patch }] };
}
