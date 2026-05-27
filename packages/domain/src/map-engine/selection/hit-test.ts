import type { BoundsRect } from '../geometry/bounds.js';
import { getSeatBounds, intersectsRect, normalizeBoundsRect } from '../geometry/bounds.js';
import { getObjectBounds } from '../layout/object-bounds.js';
import { getSeatGroupWorldBounds } from '../layout/seat-group-bounds.js';
import type { MapSelectionItem } from '../selection/selection-utils.js';
import type { EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';

export type HitTestOptions = {
  includeLockedObjects?: boolean;
  includeLockedSeatGroups?: boolean;
  includeGroupedSeats?: boolean;
  includeSoldSeats?: boolean;
};

export type MarqueeHitTestInput = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  objects: EventMapObjectDTO[];
  seats: EventSeatDTO[];
  seatGroups: EventSeatGroupDTO[];
  options?: HitTestOptions;
};

function selectionKey(item: MapSelectionItem) {
  return `${item.type}:${item.id}`;
}

export function hitTestRect(
  box: BoundsRect,
  input: Omit<MarqueeHitTestInput, 'start' | 'current'>,
): MapSelectionItem[] {
  const items: MapSelectionItem[] = [];
  const seen = new Set<string>();
  const options = input.options ?? {};

  for (const object of input.objects) {
    if (object.locked && !options.includeLockedObjects) continue;
    const bounds = getObjectBounds(object);
    if (!intersectsRect(box, bounds)) continue;

    const item: MapSelectionItem =
      object.sectionId && object.type === 'SECTION'
        ? { type: 'section', id: object.sectionId }
        : { type: 'object', id: object.id };
    const key = selectionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  for (const seat of input.seats) {
    if (seat.groupId != null && !options.includeGroupedSeats) continue;
    if (seat.status === 'SOLD' && !options.includeSoldSeats) continue;
    if (!intersectsRect(box, getSeatBounds(seat))) continue;
    const key = selectionKey({ type: 'seat', id: seat.id });
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: 'seat', id: seat.id });
  }

  for (const group of input.seatGroups) {
    if (group.locked && !options.includeLockedSeatGroups) continue;
    const bounds = getSeatGroupWorldBounds(group, input.seats);
    if (!intersectsRect(box, bounds)) continue;
    const key = selectionKey({ type: 'seatgroup', id: group.id });
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: 'seatgroup', id: group.id });
  }

  return items;
}

export function hitTestMarquee(input: MarqueeHitTestInput): MapSelectionItem[] {
  const box = normalizeBoundsRect(input.start, input.current);
  return hitTestRect(box, input);
}

export { normalizeBoundsRect };
