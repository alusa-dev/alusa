import {
  corridorIsCornerResizeAnchor,
  corridorIsEdgeResizeAnchor,
  resolveCorridorResizeMode,
  shouldUseUniformGroupScale,
} from '../corridor/corridor-resize-mode';
import { resolveCorridorTransformerScaleOptions } from '../transform/transform-handle-mode';

import { describe, expect, it } from 'vitest';

describe('corridor-resize-mode', () => {
  it('classifies edge and corner anchors', () => {
    expect(corridorIsEdgeResizeAnchor('middle-right')).toBe(true);
    expect(corridorIsCornerResizeAnchor('middle-right')).toBe(false);
    expect(corridorIsCornerResizeAnchor('top-left')).toBe(true);
    expect(resolveCorridorResizeMode('middle-right')).toBe('edge');
    expect(resolveCorridorResizeMode('bottom-right')).toBe('corner');
  });

  it('uses uniform scale only for multi-select corner handles', () => {
    expect(shouldUseUniformGroupScale('middle-right', 2)).toBe(false);
    expect(shouldUseUniformGroupScale('bottom-right', 2)).toBe(true);
    expect(shouldUseUniformGroupScale('bottom-right', 1)).toBe(false);
  });

  it('exposes transformer scale options', () => {
    expect(resolveCorridorTransformerScaleOptions('middle-left', 2)).toEqual({
      keepRatio: false,
      centeredScaling: false,
      resizeMode: 'edge',
      handleMode: 'edge',
    });
    expect(resolveCorridorTransformerScaleOptions('top-left', 3)).toEqual({
      keepRatio: true,
      centeredScaling: true,
      resizeMode: 'corner',
      handleMode: 'corner-group',
    });
  });
});
