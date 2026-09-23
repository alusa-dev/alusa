import { describe, expect, it } from 'vitest';

import { SECTION_VISUAL_PADDING, getSectionVisualBounds } from '../index';

describe('section-geometry', () => {
  it('derives the visual boundary from the current seat positions', () => {
    expect(
      getSectionVisualBounds([
        { x: 100, y: 120, size: 24 },
        { x: 148, y: 168, size: 32 },
      ]),
    ).toEqual({
      x: 64,
      y: 84,
      width: 124,
      height: 124,
    });
  });

  it('does not create a frame for an empty section', () => {
    expect(getSectionVisualBounds([])).toBeNull();
  });

  it('allows a smaller visual padding for compact maps', () => {
    expect(getSectionVisualBounds([{ x: 100, y: 100, size: 20 }], 8)).toEqual({
      x: 82,
      y: 82,
      width: 36,
      height: 36,
    });
    expect(SECTION_VISUAL_PADDING).toBe(24);
  });
});
