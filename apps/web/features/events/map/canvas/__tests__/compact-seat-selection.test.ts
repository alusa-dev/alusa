import type { EventMapDocument, MapSelectionItem } from '@alusa/domain';
import { describe, expect, it } from 'vitest';
import { compactParametricSeatSelection } from '../sessions/compact-seat-selection';

function createDocument(): EventMapDocument {
  return {
    schemaVersion: 1,
    sections: [
      {
        id: 'section-a',
        levelId: 'level-1',
        name: 'Setor A',
        color: '#7c3aed',
        position: { x: 0, y: 0 },
        rotation: 0,
        outline: [],
        blockIds: ['block-a', 'block-b'],
        blocks: [
          {
            id: 'block-a',
            sectionId: 'section-a',
            rowGap: 10,
            defaultSeatGap: 8,
            distribution: [{ type: 'SEATS', count: 2 }],
            rowIds: ['row-a1', 'row-a2'],
            rows: [
              { id: 'row-a1', sectionId: 'section-a', blockId: 'block-a', label: 'A', path: { type: 'LINE', start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }, seatGap: 8, seatSize: 12, seatIds: ['a1', 'a2'], seats: [] },
              { id: 'row-a2', sectionId: 'section-a', blockId: 'block-a', label: 'B', path: { type: 'LINE', start: { x: 0, y: 30 }, end: { x: 20, y: 30 } }, seatGap: 8, seatSize: 12, seatIds: ['a3', 'a4'], seats: [] },
            ],
          },
          {
            id: 'block-b',
            sectionId: 'section-a',
            rowGap: 10,
            defaultSeatGap: 8,
            distribution: [{ type: 'SEATS', count: 2 }],
            rowIds: ['row-b1'],
            rows: [
              { id: 'row-b1', sectionId: 'section-a', blockId: 'block-b', label: 'C', path: { type: 'LINE', start: { x: 50, y: 0 }, end: { x: 70, y: 0 } }, seatGap: 8, seatSize: 12, seatIds: ['b1', 'b2'], seats: [] },
            ],
          },
        ],
      },
    ],
    visualElements: [],
  };
}

const seats = (ids: string[]): MapSelectionItem[] => ids.map((id) => ({ type: 'seat', id }));

describe('compactParametricSeatSelection', () => {
  const document = createDocument();

  it('compacts a complete selection of multiple blocks to block entities', () => {
    expect(compactParametricSeatSelection(seats(['a1', 'a2', 'a3', 'a4', 'b1', 'b2']), document)).toEqual([
      { type: 'seatblock', id: 'block-a' },
      { type: 'seatblock', id: 'block-b' },
    ]);
  });

  it('compacts all currently projected seats even when progressive rows retain inactive seat IDs', () => {
    expect(
      compactParametricSeatSelection(seats(['a1', 'a2', 'a3', 'b1', 'b2']), document, ['a1', 'a2', 'a3', 'b1', 'b2']),
    ).toEqual([
      { type: 'seatblock', id: 'block-a' },
      { type: 'seatblock', id: 'block-b' },
    ]);
  });

  it('compacts complete rows when the marquee does not include every row in a block', () => {
    expect(compactParametricSeatSelection(seats(['a1', 'a2']), document)).toEqual([
      { type: 'seatrow', id: 'row-a1' },
    ]);
  });

  it('preserves partial-seat and mixed selections as-is', () => {
    const partial = seats(['a1', 'a2', 'b1']);
    expect(compactParametricSeatSelection(partial, document)).toBe(partial);
    const mixed: MapSelectionItem[] = [{ type: 'object', id: 'stage' }, ...seats(['a1', 'a2'])];
    expect(compactParametricSeatSelection(mixed, document)).toBe(mixed);
  });
});
