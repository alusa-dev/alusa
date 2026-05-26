import { buildGuideStops } from '@alusa/domain';
import { createSnapGuideStopCache } from '../adapters/konva-snap-adapter';

import { describe, expect, it } from 'vitest';

const levelBounds = { width: 1000, height: 800 };

describe('snap-guide-cache', () => {
  it('reuses stops for the same skip set without rebuilding', () => {
    const cache = createSnapGuideStopCache();
    const layer = {
      find: () => [],
    } as never;

    const first = cache.get(layer, ['node-a', 'node-b'], levelBounds);
    const second = cache.get(layer, ['node-b', 'node-a'], levelBounds);

    expect(second.stops).toBe(first.stops);
    expect(second.objectBounds).toBe(first.objectBounds);
  });

  it('invalidates cached stops on demand', () => {
    const cache = createSnapGuideStopCache();
    const layer = {
      find: () => [],
    } as never;

    const first = cache.get(layer, ['node-a'], levelBounds);
    cache.invalidate();
    const second = cache.get(layer, ['node-a'], levelBounds);

    expect(second.stops).not.toBe(first.stops);
    expect(second.stops).toEqual(buildGuideStops(levelBounds, []));
  });
});
