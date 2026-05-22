import { describe, expect, it } from 'vitest';

import { computeArtboardFitView } from '../lib/viewport-utils';

describe('viewport-utils', () => {
  it('centers the artboard and scales it to fit the viewport', () => {
    const fit = computeArtboardFitView({
      artboardWidth: 1600,
      artboardHeight: 1000,
      viewportWidth: 1200,
      viewportHeight: 800,
      padding: 48,
    });

    expect(fit.zoom).toBeCloseTo(0.69, 2);
    expect(fit.pan.x).toBeCloseTo((1200 - 1600 * fit.zoom) / 2, 1);
    expect(fit.pan.y).toBeCloseTo((800 - 1000 * fit.zoom) / 2, 1);
  });

  it('respects zoom limits', () => {
    const fit = computeArtboardFitView({
      artboardWidth: 200,
      artboardHeight: 200,
      viewportWidth: 1200,
      viewportHeight: 800,
      maxZoom: 1,
    });

    expect(fit.zoom).toBe(1);
  });
});
