import { expandRect, getSeatBounds, unionBounds, type BoundsRect } from '../geometry/bounds.js';
import type { EventSeatDTO } from '../types/event-map-types.js';

export const SECTION_VISUAL_PADDING = 24;

/**
 * Returns the visual boundary of a seated section from its actual seats.
 *
 * Section objects are metadata anchors used by the editor and persistence
 * layer. Their x/y/width/height must not be treated as a second source of
 * truth for what is visible on the canvas.
 */
export function getSectionVisualBounds(
  seats: Array<Pick<EventSeatDTO, 'x' | 'y' | 'size'>>,
  padding = SECTION_VISUAL_PADDING,
): BoundsRect | null {
  const seatsBounds = unionBounds(seats.map((seat) => getSeatBounds(seat)));
  return seatsBounds ? expandRect(seatsBounds, padding) : null;
}
