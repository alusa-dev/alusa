import { describe, expect, it } from 'vitest';

import { eventMapDocumentSchema } from './event-map.schema.js';

describe('event map document schema', () => {
  it('preserves per-seat row labels and seat numbers when parsing a saved document', () => {
    const result = eventMapDocumentSchema.parse({
      schemaVersion: 1,
      sections: [{
        id: 'section-1',
        levelId: 'level-1',
        name: 'Setor A',
        color: '#123456',
        position: { x: 0, y: 0 },
        rotation: 0,
        outline: [],
        blockIds: ['block-1'],
        blocks: [{
          id: 'block-1',
          sectionId: 'section-1',
          rowGap: 24,
          defaultSeatGap: 8,
          distribution: [{ type: 'SEATS', count: 1 }],
          numberingMode: 'NUMERIC',
          rowIds: ['row-1'],
          rows: [{
            id: 'row-1',
            sectionId: 'section-1',
            blockId: 'block-1',
            label: 'A',
            path: { type: 'LINE', start: { x: 0, y: 0 }, end: { x: 40, y: 0 } },
            seatGap: 8,
            seatSize: 32,
            seatIds: ['seat-1'],
            seats: [{
              id: 'seat-1',
              label: 'Balcão',
              technicalCode: 'X-17',
              rowLabel: 'VIP',
              seatNumber: '17B',
              rowIndex: 0,
              columnIndex: 0,
            }],
          }],
        }],
      }],
      visualElements: [],
    });

    expect(result.sections[0]?.blocks[0]?.rows[0]?.seats[0]).toMatchObject({
      rowLabel: 'VIP',
      seatNumber: '17B',
    });
    expect(result.sections[0]?.blocks[0]?.numberingMode).toBe('NUMERIC');
  });

  it('rejects unknown block numbering modes', () => {
    const result = eventMapDocumentSchema.safeParse({
      schemaVersion: 1,
      sections: [{
        id: 'section-1',
        levelId: 'level-1',
        name: 'Setor A',
        color: '#123456',
        position: { x: 0, y: 0 },
        rotation: 0,
        outline: [],
        blockIds: ['block-1'],
        blocks: [{
          id: 'block-1',
          sectionId: 'section-1',
          rowGap: 0,
          defaultSeatGap: 0,
          distribution: [{ type: 'SEATS', count: 0 }],
          numberingMode: 'SEQUENTIAL',
          rowIds: [],
          rows: [],
        }],
      }],
      visualElements: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects duplicate IDs and children stored under a different parent', () => {
    const document = {
      schemaVersion: 1 as const,
      sections: [{
        id: 'section-1',
        levelId: 'level-1',
        name: 'Setor A',
        color: '#123456',
        position: { x: 0, y: 0 },
        rotation: 0,
        outline: [],
        blockIds: ['block-1'],
        blocks: [{
          id: 'block-1',
          sectionId: 'another-section',
          rowGap: 0,
          defaultSeatGap: 0,
          distribution: [{ type: 'SEATS' as const, count: 0 }],
          rowIds: [],
          rows: [],
        }],
      }],
      visualElements: [
        { id: 'object-1', levelId: 'level-1', type: 'RECTANGLE', data: {}, x: 0, y: 0, rotation: 0, locked: false, hidden: false, sortOrder: 0 },
        { id: 'object-1', levelId: 'level-1', type: 'RECTANGLE', data: {}, x: 10, y: 10, rotation: 0, locked: false, hidden: false, sortOrder: 1 },
      ],
    };

    const result = eventMapDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain('O identificador de objeto está duplicado.');
      expect(result.error.issues.map((issue) => issue.message)).toContain('O bloco precisa pertencer ao setor em que está armazenado.');
    }
  });
});
