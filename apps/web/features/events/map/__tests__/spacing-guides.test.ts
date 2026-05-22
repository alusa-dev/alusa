import { describe, expect, it } from 'vitest';

import { findSpacingSnaps, mergeSnapDeltas } from '../lib/spacing-guides';

describe('spacing-guides', () => {
  it('snaps to replicate an existing horizontal gap', () => {
    const rect1 = { x: 100, y: 300, width: 180, height: 110 };
    const rect2 = { x: 340, y: 300, width: 180, height: 110 };
    const dragged = { x: 583, y: 300, width: 180, height: 110 };

    const result = findSpacingSnaps(dragged, [rect1, rect2], 8);

    expect(result.deltaX).toBe(-3);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      orientation: 'H',
      gap: 60,
      type: 'spacing',
    });
    expect(result.guides[0]?.segments).toHaveLength(2);
    expect(result.guides[0]?.segments[0]?.role).toBe('active');
    expect(result.guides[0]?.segments[1]?.role).toBe('reference');
  });

  it('snaps to equal spacing between two neighbors', () => {
    const left = { x: 100, y: 300, width: 180, height: 110 };
    const right = { x: 700, y: 300, width: 180, height: 110 };
    const dragged = { x: 403, y: 300, width: 180, height: 110 };

    const result = findSpacingSnaps(dragged, [left, right], 8);

    expect(result.deltaX).toBe(-3);
    expect(result.guides).toHaveLength(2);
    expect(result.guides.every((guide) => guide.gap === 120)).toBe(true);
  });

  it('prefers the closest spacing snap on each axis', () => {
    const rect1 = { x: 100, y: 300, width: 180, height: 110 };
    const rect2 = { x: 340, y: 300, width: 180, height: 110 };
    const dragged = { x: 577, y: 300, width: 180, height: 110 };

    const result = findSpacingSnaps(dragged, [rect1, rect2], 8);

    expect(result.deltaX).toBe(3);
    expect(result.diffX).toBeLessThanOrEqual(8);
  });

  it('merges edge and spacing deltas per axis by proximity', () => {
    expect(
      mergeSnapDeltas(
        { x: 2, y: 0 },
        { x: 5, y: 0 },
        { x: 2, y: Number.POSITIVE_INFINITY },
        { x: 1, y: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({ x: 5, y: 0 });

    expect(
      mergeSnapDeltas(
        { x: 1, y: 0 },
        { x: 6, y: 0 },
        { x: 1, y: Number.POSITIVE_INFINITY },
        { x: 4, y: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({ x: 1, y: 0 });
  });

  it('keeps the spacing owner when the gap is already exact near a page-center guide', () => {
    expect(
      mergeSnapDeltas(
        { x: -2, y: 0 },
        { x: 0, y: 0 },
        { x: 2, y: Number.POSITIVE_INFINITY },
        { x: 0, y: Number.POSITIVE_INFINITY },
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it('keeps spacing responsive with many distant objects by using nearby references', () => {
    const nearLeft = { x: 100, y: 300, width: 180, height: 110 };
    const nearRight = { x: 340, y: 300, width: 180, height: 110 };
    const distant = Array.from({ length: 140 }, (_, index) => ({
      x: 20_000 + index * 80,
      y: 20_000 + index * 40,
      width: 40,
      height: 40,
    }));
    const dragged = { x: 583, y: 300, width: 180, height: 110 };

    const result = findSpacingSnaps(dragged, [...distant, nearLeft, nearRight], 8);

    expect(result.deltaX).toBe(-3);
    expect(result.guides[0]).toMatchObject({
      orientation: 'H',
      gap: 60,
    });
  });
});
