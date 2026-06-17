import {
  filterPublicMapObjectsByLevel,
  filterPublicMapRenderableObjects,
  filterPublicMapSeatsByLevel,
  getDefaultPublicMapLevelId,
  getPublicMapLevelById,
  resolvePublicMapLevels,
} from '../public-map-level-view';

import { describe, expect, it } from 'vitest';

const levels = [
  { id: 'level-base', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900 },
  { id: 'level-mezanino', name: 'Mezanino', sortOrder: 1, widthPx: 1440, heightPx: 900 },
  { id: 'level-terreo', name: 'Térreo', sortOrder: 2, widthPx: 1440, heightPx: 900 },
];

describe('public-map-level-view', () => {
  it('orders public tabs like the editor panel (upper floors first, base last)', () => {
    const sorted = resolvePublicMapLevels(levels);
    expect(sorted.map((level) => level.id)).toEqual(['level-terreo', 'level-mezanino', 'level-base']);
  });

  it('defaults to the first tab in panel order', () => {
    expect(getDefaultPublicMapLevelId(levels)).toBe('level-terreo');
  });

  it('resolves the active level by id with panel fallback', () => {
    expect(getPublicMapLevelById(levels, 'level-mezanino').name).toBe('Mezanino');
    expect(getPublicMapLevelById(levels, 'missing').id).toBe('level-terreo');
  });

  it('filters objects and seats to the active environment only', () => {
    const objects = [
      { id: 'obj-a', levelId: 'level-base', hidden: false },
      { id: 'obj-b', levelId: 'level-mezanino', hidden: false },
      { id: 'obj-hidden', levelId: 'level-mezanino', hidden: true },
    ];
    const seats = [
      { id: 'seat-a', levelId: 'level-base' },
      { id: 'seat-b', levelId: 'level-mezanino' },
    ];

    expect(filterPublicMapObjectsByLevel(objects, 'level-mezanino').map((item) => item.id)).toEqual(['obj-b']);
    expect(filterPublicMapSeatsByLevel(seats, 'level-base').map((item) => item.id)).toEqual(['seat-a']);
  });

  it('hides seated sector SECTION objects from the public map canvas', () => {
    const map = {
      seatGroups: [{ id: 'group-1' }],
      seats: [{ id: 'seat-1', groupId: 'group-1', sectionId: 'section-1' }],
    };
    const objects = [
      { id: 'section-obj', type: 'SECTION', sectionId: 'section-1', levelId: 'level-base', hidden: false },
      { id: 'stage-obj', type: 'STAGE', levelId: 'level-base', hidden: false },
      { id: 'orphan-section', type: 'SECTION', sectionId: 'section-orphan', levelId: 'level-base', hidden: false },
    ];

    expect(filterPublicMapRenderableObjects(map, objects, 'level-base').map((item) => item.id)).toEqual([
      'stage-obj',
      'orphan-section',
    ]);
  });
});
