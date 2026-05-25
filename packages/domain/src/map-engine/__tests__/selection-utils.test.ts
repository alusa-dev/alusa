import { getPrimarySelection, getSelectableItems, intersectsRect, normalizeSelection, toggleSelectionItem } from '../index';

import { describe, expect, it } from 'vitest';

describe('selection-utils', () => {
  it('normalizes single and array selections', () => {
    expect(normalizeSelection(null)).toEqual([]);
    expect(normalizeSelection({ type: 'object', id: 'a' })).toEqual([{ type: 'object', id: 'a' }]);
  });

  it('toggles items and removes level when selecting objects', () => {
    const next = toggleSelectionItem([{ type: 'level', id: 'level-1' }], { type: 'object', id: 'obj-1' });
    expect(next).toEqual([{ type: 'object', id: 'obj-1' }]);
  });

  it('returns primary non-level selection', () => {
    const primary = getPrimarySelection([
      { type: 'object', id: 'a' },
      { type: 'object', id: 'b' },
    ]);
    expect(primary).toEqual({ type: 'object', id: 'b' });
    expect(getSelectableItems([{ type: 'level', id: 'l1' }, { type: 'seat', id: 's1' }])).toHaveLength(1);
  });

  it('detects rectangle intersection', () => {
    expect(
      intersectsRect(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 80, y: 80, width: 40, height: 40 },
      ),
    ).toBe(true);
    expect(
      intersectsRect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 10, height: 10 },
      ),
    ).toBe(false);
  });
});
