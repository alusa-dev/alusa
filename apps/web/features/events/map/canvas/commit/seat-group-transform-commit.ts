import type Konva from 'konva';
import type { EventSeatGroupDTO } from '../api/event-map-service';

export type CommitSeatGroupTransformParams = {
  group: EventSeatGroupDTO;
  node: Konva.Node;
  updateSeatGroup: (groupId: string, patch: Partial<EventSeatGroupDTO>) => void;
  lastTransformCommitRef: { current: Map<string, { x: number; y: number }> };
};

export function commitSeatGroupTransform({
  group,
  node,
  updateSeatGroup,
  lastTransformCommitRef,
}: CommitSeatGroupTransformParams) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const x = node.x();
  const y = node.y();
  const rotation = node.rotation();

  node.scaleX(1);
  node.scaleY(1);

  if (![scaleX, scaleY, x, y, rotation].every(Number.isFinite)) return;

  lastTransformCommitRef.current.set(`seatgroup-${group.id}`, { x, y });
  updateSeatGroup(group.id, {
    x,
    y,
    rotation,
    seatWidth: Math.max(8, group.seatWidth * Math.abs(scaleX || 1)),
    seatHeight: Math.max(8, group.seatHeight * Math.abs(scaleY || 1)),
    gapX: Math.max(0, group.gapX * Math.abs(scaleX || 1)),
    gapY: Math.max(0, group.gapY * Math.abs(scaleY || 1)),
    paddingLeft: Math.max(0, group.paddingLeft * Math.abs(scaleX || 1)),
    paddingRight: Math.max(0, group.paddingRight * Math.abs(scaleX || 1)),
    paddingTop: Math.max(0, group.paddingTop * Math.abs(scaleY || 1)),
    paddingBottom: Math.max(0, group.paddingBottom * Math.abs(scaleY || 1)),
  });
}
