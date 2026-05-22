import type Konva from 'konva';

import {
  buildGuideStops,
  collectSnapTargetBounds,
  isFiniteBoundingBox,
  type BoundingBox,
  type LevelBounds,
  type SnapGuideStops,
} from './snap-guides';

export type SnapGuideStopCacheEntry = {
  skipKey: string;
  stops: SnapGuideStops;
  objectBounds: BoundingBox[];
};

/** Reuse guide stops for the duration of a drag/resize — avoids layer.find every frame. */
export function createSnapGuideStopCache() {
  let entry: SnapGuideStopCacheEntry | null = null;

  return {
    get(contentLayer: Konva.Layer, skipIds: string[], levelBounds: LevelBounds): SnapGuideStopCacheEntry {
      const skipKey = [...skipIds].sort().join('|');
      if (entry?.skipKey === skipKey) {
        return entry;
      }

      const objectBounds = collectSnapTargetBounds(contentLayer, skipIds).filter(isFiniteBoundingBox);
      const stops = buildGuideStops(levelBounds, objectBounds);
      entry = { skipKey, stops, objectBounds };
      return entry;
    },
    invalidate() {
      entry = null;
    },
  };
}
