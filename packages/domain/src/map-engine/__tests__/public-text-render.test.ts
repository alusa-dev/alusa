import {
  buildPublicMapTextLines,
  getPublicMapTextAnchor,
  getPublicMapTextAnchorX,
  getPublicMapTextStartY,
} from '../doc/public-text-render.js';

import { describe, expect, it } from 'vitest';

describe('buildPublicMapTextLines', () => {
  it('keeps auto mode as a single line', () => {
    const lines = buildPublicMapTextLines({
      width: null,
      height: null,
      data: { text: 'Bryan de alencar', textMode: 'auto', fontWeight: 'bold' },
    });

    expect(lines).toEqual(['Bryan de alencar']);
  });

  it('wraps fixed-width text using the object width', () => {
    const lines = buildPublicMapTextLines({
      width: 80,
      height: null,
      data: {
        text: 'Bryan de alencar festival',
        textMode: 'fixed-width',
        fontSize: 30,
        fontWeight: 'bold',
      },
    });

    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('public text anchors', () => {
  it('uses the object x as the anchor for centered auto text', () => {
    expect(getPublicMapTextAnchor('center')).toBe('middle');
    expect(
      getPublicMapTextAnchorX(
        { x: 120, width: null, data: { textMode: 'auto', align: 'center' } },
        'center',
      ),
    ).toBe(120);
  });

  it('offsets y for vertically centered area text', () => {
    const startY = getPublicMapTextStartY(
      {
        y: 40,
        height: 120,
        data: { textMode: 'area', verticalAlign: 'middle', lineHeight: 1.2, fontSize: 20 },
      },
      2,
      20,
      1.2,
    );

    expect(startY).toBe(76);
  });
});
