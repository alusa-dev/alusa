import { describe, expect, it } from 'vitest';
import type { EventMapDTO } from '../types/event-map-types.js';
import { buildLevelRenderStack } from './render-layer-order.js';

describe('buildLevelRenderStack', () => {
  it('renders section row guides between lower shapes and seats, while preserving upper layers', () => {
    const map = {
      document: {
        sections: [{ id: 'section-1', levelId: 'level-1', blocks: [{}] }],
      },
      sections: [{ id: 'section-1', levelId: 'level-1', sortOrder: 5, hidden: false }],
      objects: [
        { id: 'shape-below', levelId: 'level-1', hidden: false, sortOrder: 4 },
        { id: 'section-object', levelId: 'level-1', sectionId: 'section-1', type: 'SECTION', hidden: false, sortOrder: 5 },
        { id: 'shape-above', levelId: 'level-1', hidden: false, sortOrder: 10 },
      ],
      seats: [{ id: 'seat-1', levelId: 'level-1', sectionId: 'section-1', publicVisible: true }],
    } as EventMapDTO;

    expect(buildLevelRenderStack(map, 'level-1')).toEqual([
      { kind: 'object', id: 'shape-below', sortOrder: 4 },
      { kind: 'object', id: 'section-object', sortOrder: 5 },
      { kind: 'row-guides', id: 'section-1', sortOrder: 5 },
      { kind: 'seat', id: 'seat-1', sectionId: 'section-1', sortOrder: 5 },
      { kind: 'object', id: 'shape-above', sortOrder: 10 },
    ]);
  });
});
