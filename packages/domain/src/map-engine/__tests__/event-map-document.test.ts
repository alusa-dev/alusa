import { describe, expect, it } from 'vitest';

import {
  MapDocumentHistory,
  applyMapDocumentCommand,
  createEmptyEventMapDocument,
  migrateLegacyMapDocument,
  deleteSelection,
  duplicateSelection,
  executeMapCommand,
  projectMapDocumentToEditorFields,
  resolveEventMapLayout,
  sectionLocalToWorld,
  validateEventMapDocument,
  worldToSectionLocal,
} from '../index.js';
import type { EventMapDocument, EventMapDTO } from '../index.js';

function documentWithRow(path: EventMapDocument['sections'][number]['blocks'][number]['rows'][number]['path']): EventMapDocument {
  return {
    schemaVersion: 1,
    visualElements: [],
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        name: 'Setor A',
        color: '#123456',
        position: { x: 100, y: 80 },
        rotation: 20,
        outline: [{ x: -100, y: -100 }, { x: 600, y: -100 }, { x: 600, y: 600 }, { x: -100, y: 600 }],
        blockIds: ['block-1'],
        blocks: [
          {
            id: 'block-1',
            sectionId: 'section-1',
            rowGap: 40,
            defaultSeatGap: 10,
            distribution: [{ type: 'SEATS', count: 2 }, { type: 'GAP', width: 50 }, { type: 'SEATS', count: 2 }],
            rowIds: ['row-1'],
            rows: [
              {
                id: 'row-1',
                sectionId: 'section-1',
                blockId: 'block-1',
                label: 'A',
                path,
                seatGap: 10,
                seatSize: 20,
                seatIds: ['seat-1', 'seat-2', 'seat-3', 'seat-4'],
                seats: [1, 2, 3, 4].map((index) => ({ id: `seat-${index}`, label: `A${index}`, technicalCode: `A${index}`, rowIndex: 0, columnIndex: index - 1 })),
              },
            ],
          },
        ],
      },
    ],
  };
}

function editorMapFromDocument(document: EventMapDocument): EventMapDTO {
  const projection = projectMapDocumentToEditorFields(document);
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: new Date().toISOString(), status: 'PLANNING', ticketMode: 'NUMBERED_SEATS' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    publicSlug: null,
    publicEnabled: false,
    publicUrl: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: null,
    archivedAt: null,
    document,
    referenceChart: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1000, heightPx: 800, unit: 'px', scale: null }],
    sections: projection.sections,
    objects: projection.objects,
    seats: projection.seats,
    versions: [],
    counts: { levels: 1, sections: projection.sections.length, seats: projection.seats.length, availableSeats: projection.seats.length, orders: 0 },
  };
}

describe('event map document engine', () => {
  it('keeps an explicitly empty section name in canonical and legacy visual labels', () => {
    const document = createEmptyEventMapDocument();
    document.sections.push({
      id: 'section-1', levelId: 'level-1', name: 'Setor A', color: '#123456',
      position: { x: 0, y: 0 }, rotation: 0, outline: [], blockIds: [], blocks: [],
    });
    document.visualElements.push({
      id: 'section-label', levelId: 'level-1', sectionId: 'section-1', type: 'SECTION',
      data: { label: 'Setor A' }, x: 0, y: 0, rotation: 0, locked: false, hidden: false, sortOrder: 0,
    });
    const canonicalMap = editorMapFromDocument(document);
    const canonical = executeMapCommand(canonicalMap, {
      type: 'UPDATE_ITEMS', payload: { sections: [{ id: 'section-1', patch: { name: '' } }] },
    }, { selection: [] });
    expect(canonical.map.document?.sections[0]?.name).toBe('');
    expect(canonical.map.document?.visualElements[0]?.data.label).toBe('');

    const legacyMap = {
      ...canonicalMap,
      document: undefined,
      sections: [{ ...canonicalMap.sections[0]!, name: 'Setor A' }],
      objects: [{
        id: 'section-label', levelId: 'level-1', sectionId: 'section-1', type: 'SECTION' as const,
        data: { label: 'Setor A' }, x: 0, y: 0, width: null, height: null, rotation: 0,
        locked: false, hidden: false, sortOrder: 0,
      }],
    };
    const legacy = executeMapCommand(legacyMap, {
      type: 'UPDATE_ITEMS', payload: { sections: [{ id: 'section-1', patch: { name: '' } }] },
    }, { selection: [] });
    expect(legacy.map.sections[0]?.name).toBe('');
    expect(legacy.map.objects[0]?.data.label).toBe('');
  });

  it('respects an explicit null lot through document replacement and inherits only absent legacy values', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    const previousSection = {
      ...projectMapDocumentToEditorFields(document).sections[0]!,
      lotId: 'lot-legacy',
      lot: { id: 'lot-legacy', name: 'Lote antigo', unitPrice: 30, status: 'ACTIVE' as const, quantityTotal: 20, quantitySold: 3 },
    };
    document.sections[0]!.lotId = null;

    expect(projectMapDocumentToEditorFields(document, { sections: [previousSection] }).sections[0]).toMatchObject({ lotId: null, lot: null });
    document.sections[0]!.lotId = 'lot-new';
    expect(projectMapDocumentToEditorFields(document, { sections: [previousSection] }).sections[0]).toMatchObject({ lotId: 'lot-new', lot: null });

    const map = editorMapFromDocument({ ...document, sections: [{ ...document.sections[0]!, lotId: 'lot-legacy' }] });
    const before = map.document!;
    const after = { ...before, sections: before.sections.map((section) => ({ ...section, lotId: null })) };
    const replaced = executeMapCommand(map, {
      type: 'REPLACE_DOCUMENT',
      payload: { before, after, description: 'Limpar lote do setor' },
    }, { selection: [] });
    expect(replaced.map.sections[0]?.lotId).toBeNull();

    delete document.sections[0]!.lotId;
    expect(projectMapDocumentToEditorFields(document, { sections: [previousSection] }).sections[0]).toMatchObject({ lotId: 'lot-legacy', lot: previousSection.lot });
  });

  it('round-trips section-local and world coordinates', () => {
    const local = { x: 40, y: -10 };
    const world = sectionLocalToWorld(local, { x: 100, y: 80 }, 20);
    const result = worldToSectionLocal(world, { x: 100, y: 80 }, 20);
    expect(result.x).toBeCloseTo(local.x, 8);
    expect(result.y).toBeCloseTo(local.y, 8);
  });

  it('resolves a line with structured gaps', () => {
    const result = resolveEventMapLayout(documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } }));
    expect(result.seats).toHaveLength(4);
    expect(result.seats[0]!.x).toBeCloseTo(10);
    expect(result.seats[1]!.x).toBeCloseTo(40);
    expect(result.seats[2]!.x).toBeCloseTo(110);
    expect(result.seats[3]!.x).toBeCloseTo(140);
    expect(result.seats[1]!.x - result.seats[0]!.x).toBeLessThan(result.seats[2]!.x - result.seats[1]!.x);
  });

  it('resolves an arc and derives seat rotation from its tangent', () => {
    const result = resolveEventMapLayout(documentWithRow({ type: 'ARC', center: { x: 0, y: 0 }, radius: 100, startAngle: 0, endAngle: Math.PI / 2, clockwise: false }));
    expect(result.seats).toHaveLength(4);
    expect(result.seats[0]!.x).toBeGreaterThan(0);
    expect(result.seats[0]!.rotation).not.toBe(0);
  });

  it('resolves a segmented row by accumulated distance', () => {
    const result = resolveEventMapLayout(documentWithRow({ type: 'POLYLINE', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 100 }] }));
    expect(result.seats).toHaveLength(4);
    expect(result.seats[0]!.x).toBeCloseTo(10);
    expect(result.seats[2]!.x).toBeCloseTo(60);
    expect(result.seats[2]!.y).toBeGreaterThan(0);
  });

  it('resolves progressive distribution without moving neighboring rows', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 240, y: 0 } });
    const block = document.sections[0]!.blocks[0]!;
    block.distributionMode = 'PROGRESSIVE';
    block.firstRowSeatCount = 1;
    block.lastRowSeatCount = 4;
    const firstRow = block.rows[0]!;
    block.rows.push({
      ...firstRow,
      id: 'row-2',
      label: 'B',
      seatIds: ['seat-5', 'seat-6', 'seat-7', 'seat-8'],
      seats: [1, 2, 3, 4].map((index) => ({
        id: `seat-${index + 4}`,
        label: `B${index}`,
        technicalCode: `B${index}`,
        rowIndex: 1,
        columnIndex: index - 1,
      })),
      path: { type: 'LINE', start: { x: 0, y: 60 }, end: { x: 240, y: 60 } },
    });
    block.rowIds.push('row-2');

    const result = resolveEventMapLayout(document);
    expect(result.rows[0]!.seatPlacements).toHaveLength(1);
    expect(result.rows[1]!.seatPlacements).toHaveLength(4);
  });

  it('aligns progressive rows to the requested side of the path', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 300, y: 0 } });
    const block = document.sections[0]!.blocks[0]!;
    block.distributionMode = 'PROGRESSIVE';
    block.distributionAlignment = 'CENTER';
    block.firstRowSeatCount = 2;
    block.lastRowSeatCount = 2;

    const result = resolveEventMapLayout(document);
    const seats = result.rows[0]!.seatPlacements;

    expect(seats[0]!.x).toBeCloseTo(135);
    expect(seats[1]!.x).toBeCloseTo(165);
  });

  it('fits seats to the real row path length', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    const block = document.sections[0]!.blocks[0]!;
    block.distributionMode = 'FIT';
    block.fitMinimumSeatCount = 1;
    block.fitMaximumSeatCount = 4;
    expect(resolveEventMapLayout(document).rows[0]!.seatPlacements).toHaveLength(3);
  });

  it('uses the same deterministic resolver for repeated input', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    expect(resolveEventMapLayout(document)).toEqual(resolveEventMapLayout(document));
  });

  it('deletes a parametric block as one canonical subtree', () => {
    const map = editorMapFromDocument(documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } }));
    const result = deleteSelection({ map, selection: [{ type: 'seatblock', id: 'block-1' }] });

    expect(result.blocked).toBe(false);
    expect(result.map.document?.sections).toHaveLength(0);
    expect(result.map.seats).toHaveLength(0);
  });

  it('duplicates a grouped object as one independent group', () => {
    const map = editorMapFromDocument(createEmptyEventMapDocument());
    map.document = undefined;
    const object = (id: string, sortOrder: number) => ({
      id, levelId: 'level-1', sectionId: null, type: 'RECTANGLE', data: { groupId: 'group-1', groupLabel: 'Grupo 01' },
      x: sortOrder * 10, y: 0, width: 20, height: 20, rotation: 0, locked: false, hidden: false, sortOrder,
    });
    map.objects = [object('object-1', 1), object('object-2', 2)];

    const result = duplicateSelection({ map, selection: [{ type: 'object', id: 'object-1' }] });
    const copies = result.map.objects.filter((entry) => !map.objects.some((source) => source.id === entry.id));
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((entry) => entry.data.groupId)).size).toBe(1);
    expect(copies[0]!.data.groupId).not.toBe('group-1');
  });

  it('keeps canonical visual elements in sync when deletion sanitizes group membership', () => {
    const map = editorMapFromDocument(createEmptyEventMapDocument());
    const object = (id: string, groupId?: string) => ({
      id, levelId: 'level-1', sectionId: null, type: 'RECTANGLE',
      data: groupId ? { groupId, groupLabel: 'Grupo 01' } : {},
      x: 0, y: 0, width: 20, height: 20, rotation: 0, locked: false, hidden: false, sortOrder: 0,
    });
    map.objects = [object('group-member-1', 'group-1'), object('independent-object')];
    map.document = { ...map.document!, visualElements: map.objects };

    const result = deleteSelection({ map, selection: [{ type: 'object', id: 'independent-object' }] });
    expect(result.map.document?.visualElements).toEqual(result.map.objects);
    expect(result.map.objects).toHaveLength(1);
    expect(result.map.objects.every((entry) => !('groupId' in entry.data))).toBe(true);
  });

  it('creates a section atomically in the canonical document through the command reducer', () => {
    const map = editorMapFromDocument(createEmptyEventMapDocument());
    const created = executeMapCommand(map, {
      type: 'ADD_OBJECT',
      payload: { id: 'section-command-id', tool: 'section', point: { x: 40, y: 60 }, size: { width: 180, height: 120 } },
    }, {
      activeLevelId: 'level-1',
      selection: [],
      runtime: { createId: (prefix) => `${prefix}-created` },
    });

    expect(created.map.document?.sections).toHaveLength(1);
    expect(created.map.document?.sections[0]).toMatchObject({
      id: 'section-created',
      levelId: 'level-1',
      position: { x: 40, y: 60 },
      outline: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 120 }, { x: 0, y: 120 }],
    });
    expect(created.map.sections.map((section) => section.id)).toEqual(['section-created']);
    expect(created.map.document?.visualElements).toEqual(created.map.objects);

    const undone = executeMapCommand(created.map, created.undoCommand!, { activeLevelId: 'level-1', selection: [] });
    expect(undone.map.document?.sections).toHaveLength(0);
    expect(undone.map.objects).toHaveLength(0);
  });

  it('returns a warning when a command cannot create the requested item', () => {
    const map = editorMapFromDocument(createEmptyEventMapDocument());
    const result = executeMapCommand(map, {
      type: 'ADD_OBJECT',
      payload: { id: 'unused', tool: 'row', point: { x: 0, y: 0 } },
    }, { activeLevelId: 'level-1', selection: [] });

    expect(result.map).toBe(map);
    expect(result.patches).toEqual([]);
    expect(result.warnings).toContain('Use a ferramenta de assentos para criar fileiras e lugares.');
  });

  it('normalizes section and descendant selections and restores linked elements on duplicate undo/redo', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    document.visualElements.push({
      id: 'visual-1', levelId: 'level-1', sectionId: 'section-1', type: 'TEXT', data: { text: 'Setor' },
      x: 120, y: 100, width: 80, height: 30, rotation: 0, locked: false, hidden: false, sortOrder: 1,
    });
    const map = editorMapFromDocument(document);
    const blockId = document.sections[0]!.blocks[0]!.id;
    const rowId = document.sections[0]!.blocks[0]!.rows[0]!.id;
    const duplicated = executeMapCommand(map, {
      type: 'DUPLICATE_SELECTION',
      payload: { selection: [
        { type: 'section', id: 'section-1' }, { type: 'seatblock', id: blockId },
        { type: 'seatrow', id: rowId }, { type: 'object', id: 'visual-1' },
      ] },
    }, { activeLevelId: 'level-1', selection: [{ type: 'section', id: 'section-1' }] });
    expect(duplicated.map.document?.sections).toHaveLength(2);
    expect(duplicated.map.document?.visualElements).toHaveLength(2);
    const copiedSection = duplicated.map.document!.sections.find((section) => section.id !== 'section-1')!;
    expect(copiedSection.blocks).toHaveLength(1);
    expect(copiedSection.blocks[0]!.rows).toHaveLength(1);

    const undone = executeMapCommand(duplicated.map, duplicated.undoCommand!, { activeLevelId: 'level-1', selection: [] });
    expect(undone.map.document?.sections).toHaveLength(1);
    expect(undone.map.document?.visualElements.map((element) => element.id)).toEqual(['visual-1']);
    const redone = executeMapCommand(undone.map, undone.undoCommand!, { activeLevelId: 'level-1', selection: [] });
    expect(redone.map.document?.sections).toHaveLength(2);
    expect(redone.map.document?.visualElements).toHaveLength(2);
    expect(redone.map.document?.visualElements.every((element) => element.sectionId && redone.map.document?.sections.some((section) => section.id === element.sectionId))).toBe(true);
  });

  it('rejects invalid duplication at the command boundary without changing the map', () => {
    const map = editorMapFromDocument(createEmptyEventMapDocument());
    const result = executeMapCommand(map, {
      type: 'DUPLICATE_SELECTION', payload: { selection: [{ type: 'level', id: 'level-1' }] },
    }, { activeLevelId: 'level-1', selection: [{ type: 'level', id: 'level-1' }] });
    expect(result.map).toEqual(map);
    expect(result.patches).toEqual([]);
    expect(result.warnings).toContain('Planos não podem ser duplicados por este atalho.');
  });

  it('undoes a parametric deletion by restoring the complete canonical document', () => {
    const map = editorMapFromDocument(documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } }));
    const deleted = executeMapCommand(
      map,
      { type: 'DELETE_SELECTION', payload: { selection: [{ type: 'seatblock', id: 'block-1' }] } },
      { activeLevelId: 'level-1', selection: [{ type: 'seatblock', id: 'block-1' }] },
    );
    expect(deleted.undoCommand?.type).toBe('REPLACE_DOCUMENT');

    const restored = executeMapCommand(
      deleted.map,
      deleted.undoCommand!,
      { activeLevelId: 'level-1', selection: [] },
    );
    expect(restored.map.document?.sections).toHaveLength(1);
    expect(restored.map.document?.sections[0]?.blocks).toHaveLength(1);
    expect(restored.map.seats).toHaveLength(4);

    const redone = executeMapCommand(
      restored.map,
      { type: 'DELETE_SELECTION', payload: { selection: [{ type: 'seatblock', id: 'block-1' }] } },
      { activeLevelId: 'level-1', selection: [{ type: 'seatblock', id: 'block-1' }] },
    );
    expect(redone.map.document?.sections).toHaveLength(0);
    expect(redone.map.seats).toHaveLength(0);
  });

  it('blocks deleting a parametric subtree with an operational seat', () => {
    const map = editorMapFromDocument(documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } }));
    map.seats[0]!.status = 'SOLD';
    const result = deleteSelection({ map, selection: [{ type: 'seatblock', id: 'block-1' }] });

    expect(result.blocked).toBe(true);
    expect(result.map.document?.sections[0]?.blocks).toHaveLength(1);
    expect(result.warnings[0]).toContain('vendido');
  });

  it('removes section-linked visual elements when deleting the last seat block removes its section', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    document.visualElements.push({
      id: 'section-label',
      levelId: 'level-1',
      sectionId: 'section-1',
      type: 'TEXT',
      data: { text: 'Setor A' },
      x: 120,
      y: 40,
      width: 80,
      height: 20,
      rotation: 0,
      locked: false,
      hidden: false,
      sortOrder: 1,
    });
    const result = deleteSelection({
      map: editorMapFromDocument(document),
      selection: [{ type: 'seatblock', id: 'block-1' }],
    });

    expect(result.map.document?.sections).toHaveLength(0);
    expect(result.map.document?.visualElements).toHaveLength(0);
    expect(result.map.objects).toHaveLength(0);
  });

  it('persists a block translation in the canonical row path', () => {
    const map = editorMapFromDocument(documentWithRow({ type: 'LINE', start: { x: 20, y: 30 }, end: { x: 200, y: 30 } }));
    const originalSeat = map.seats[0]!;
    const result = executeMapCommand(
      map,
      { type: 'MOVE_SELECTION', payload: { selection: [{ type: 'seatblock', id: 'block-1' }], delta: { x: 12, y: 18 } } },
      { selection: [{ type: 'seatblock', id: 'block-1' }] },
    );

    const row = result.map.document?.sections[0]?.blocks[0]?.rows[0];
    const localDelta = worldToSectionLocal({ x: 12, y: 18 }, { x: 0, y: 0 }, 20);
    expect(row?.path.type).toBe('LINE');
    if (row?.path.type === 'LINE') {
      expect(row.path.start.x).toBeCloseTo(20 + localDelta.x);
      expect(row.path.start.y).toBeCloseTo(30 + localDelta.y);
      expect(row.path.end.x).toBeCloseTo(200 + localDelta.x);
      expect(row.path.end.y).toBeCloseTo(30 + localDelta.y);
    }
    expect(result.map.seats[0]?.x).toBeCloseTo(originalSeat.x + 12);
    expect(result.map.seats[0]?.y).toBeCloseTo(originalSeat.y + 18);
  });

  it('persists an individual parametric-seat exception without changing the row', () => {
    const map = editorMapFromDocument(documentWithRow({ type: 'LINE', start: { x: 20, y: 30 }, end: { x: 200, y: 30 } }));
    const result = executeMapCommand(
      map,
      { type: 'MOVE_SELECTION', payload: { selection: [{ type: 'seat', id: 'seat-1' }], delta: { x: 8, y: 6 } } },
      { selection: [{ type: 'seat', id: 'seat-1' }] },
    );

    const seat = result.map.document?.sections[0]?.blocks[0]?.rows[0]?.seats[0];
    expect(seat?.position).toBeDefined();
    expect(seat?.position?.x).not.toBe(0);
    expect(result.map.document?.sections[0]?.blocks[0]?.rows[0]?.path).toEqual({ type: 'LINE', start: { x: 20, y: 30 }, end: { x: 200, y: 30 } });
  });

  it('supports one command per gesture and reversible history', () => {
    const initial = createEmptyEventMapDocument();
    const next = { ...initial, sections: [{ id: 'section-1', levelId: 'level-1', name: 'A', color: '#fff', position: { x: 0, y: 0 }, rotation: 0, outline: [], blockIds: [], blocks: [] }] };
    const command = { type: 'REPLACE_DOCUMENT' as const, before: initial, after: next, description: 'Criar seção' };
    const history = new MapDocumentHistory();
    const applied = history.execute(initial, command);
    expect(applied).toEqual(next);
    expect(history.undo(applied)).toEqual(initial);
    expect(history.redo(initial)).toEqual(next);
    expect(applyMapDocumentCommand(initial, command)).toEqual(next);
  });

  it('migrates legacy layout deterministically into the canonical document', () => {
    const document = migrateLegacyMapDocument({
      sections: [{ id: 'section-1', levelId: 'level-1', name: 'A', color: '#fff' }],
      groups: [{ id: 'group-1', sectionId: 'section-1', levelId: 'level-1', x: 0, y: 0, rotation: 0, rows: 1, columns: 2, seatWidth: 20, gapX: 10, gapY: 30 }],
      seats: [
        { id: 'seat-1', sectionId: 'section-1', rowIndex: 0, columnIndex: 0, technicalCode: 'A1', displayLabel: 'A1', rowLabel: 'A', seatNumber: '1', accessible: false, publicVisible: true },
        { id: 'seat-2', sectionId: 'section-1', rowIndex: 0, columnIndex: 1, technicalCode: 'A2', displayLabel: 'A2', rowLabel: 'A', seatNumber: '2', accessible: false, publicVisible: true },
      ],
    });
    expect(document.sections[0]!.blocks[0]!.rows[0]!.seats.map((seat) => seat.id)).toEqual(['seat-1', 'seat-2']);
  });

  it('reports invalid spacing instead of trying to push seats', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    document.sections[0]!.blocks[0]!.rows[0]!.seatGap = -30;
    expect(validateEventMapDocument(document).diagnostics.some((entry) => entry.type === 'INVALID_SPACING')).toBe(true);
  });

  it('allows parametric seat sections without a persisted visual outline', () => {
    const document = documentWithRow({ type: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } });
    document.sections[0]!.outline = [];

    expect(validateEventMapDocument(document).diagnostics.some((entry) => entry.type === 'INVALID_SECTION')).toBe(false);
  });
});
