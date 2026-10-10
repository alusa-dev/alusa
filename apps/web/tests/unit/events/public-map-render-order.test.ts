import { describe, expect, it } from 'vitest';
import { sortPublicMapRenderItems } from '../../../features/events/map/public/PublicMapExperience';

describe('public map render order', () => {
  it('keeps opaque filled shapes behind seats even when their layer order is higher', () => {
    const seat = { kind: 'seat' as const, id: 'seat-1', sortOrder: 0, seat: { id: 'seat-1' } };
    const backgroundShape = {
      kind: 'object' as const,
      id: 'shape-1',
      sortOrder: 9,
      object: {
        id: 'shape-1',
        type: 'GENERAL_AREA' as const,
        x: 47,
        y: 242,
        width: 858,
        height: 218,
        rotation: 0,
        data: { shape: 'square', fill: '#fff', fillEnabled: true },
      },
    };

    expect(sortPublicMapRenderItems([seat, backgroundShape]).map((item) => item.id)).toEqual([
      'shape-1',
      'seat-1',
    ]);
  });

  it('keeps text objects available as intentional foreground overlays', () => {
    const seat = { kind: 'seat' as const, id: 'seat-1', sortOrder: 9, seat: { id: 'seat-1' } };
    const text = {
      kind: 'object' as const,
      id: 'text-1',
      sortOrder: 0,
      object: {
        id: 'text-1',
        type: 'TEXT' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 24,
        rotation: 0,
      },
    };

    expect(sortPublicMapRenderItems([seat, text]).map((item) => item.id)).toEqual(['seat-1', 'text-1']);
  });

  it('preserves editor order between map objects', () => {
    const outline = {
      kind: 'object' as const,
      id: 'outline-1',
      sortOrder: 2,
      object: {
        id: 'outline-1',
        type: 'SECTION' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        data: { fillEnabled: false },
      },
    };
    const filled = {
      kind: 'object' as const,
      id: 'filled-1',
      sortOrder: 9,
      object: {
        id: 'filled-1',
        type: 'GENERAL_AREA' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        data: { shape: 'square', fill: '#fff', fillEnabled: true },
      },
    };

    expect(sortPublicMapRenderItems([filled, outline]).map((item) => item.id)).toEqual([
      'outline-1',
      'filled-1',
    ]);
  });
});
