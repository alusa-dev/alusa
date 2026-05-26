import type { SnapGuideLine } from '../geometry/snap-guides.js';
import { areActiveGuideVisualsEqual, resolveActiveGuideVisuals } from '../geometry/snap-guide-visuals.js';

import { describe, expect, it } from 'vitest';

const edgeGuide: SnapGuideLine = {
  lineGuide: 200,
  offset: 0,
  orientation: 'V',
  snap: 'start',
  span: { start: 100, end: 300 },
  source: 'object',
};

describe('snap-guide-visuals', () => {
  it('keeps spacing guides visible when the object is already snapped', () => {
    const visuals = resolveActiveGuideVisuals(
      [],
      {
        guides: [
          {
            type: 'spacing',
            orientation: 'H',
            gap: 60,
            segments: [
              { start: { x: 520, y: 355 }, end: { x: 580, y: 355 }, role: 'active' },
              { start: { x: 280, y: 355 }, end: { x: 340, y: 355 }, role: 'reference' },
            ],
          },
        ],
        diffX: 0,
        diffY: Number.POSITIVE_INFINITY,
      },
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      8,
    );

    expect(visuals.spacingGuides).toHaveLength(1);
    expect(visuals.guides).toHaveLength(0);
  });

  it('prefers spacing visuals over edge guides on the same axis', () => {
    const visuals = resolveActiveGuideVisuals(
      [edgeGuide],
      {
        guides: [
          {
            type: 'spacing',
            orientation: 'H',
            gap: 60,
            segments: [{ start: { x: 280, y: 355 }, end: { x: 340, y: 355 }, role: 'active' }],
          },
        ],
        diffX: 2,
        diffY: Number.POSITIVE_INFINITY,
      },
      4,
      Number.POSITIVE_INFINITY,
      8,
    );

    expect(visuals.spacingGuides).toHaveLength(1);
    expect(visuals.guides).toHaveLength(0);
  });

  it('shows edge guides when spacing does not win on that axis', () => {
    const visuals = resolveActiveGuideVisuals(
      [edgeGuide],
      { guides: [], diffX: Number.POSITIVE_INFINITY, diffY: Number.POSITIVE_INFINITY },
      2,
      Number.POSITIVE_INFINITY,
      8,
    );

    expect(visuals.guides).toHaveLength(1);
    expect(visuals.spacingGuides).toHaveLength(0);
  });

  it('detects unchanged guide payloads to skip redundant layer updates', () => {
    const payload = {
      guides: [edgeGuide],
      spacingGuides: [],
    };

    expect(areActiveGuideVisualsEqual(payload, payload)).toBe(true);
    expect(
      areActiveGuideVisualsEqual(payload, {
        guides: [{ ...edgeGuide, lineGuide: 201 }],
        spacingGuides: [],
      }),
    ).toBe(false);
  });
});
