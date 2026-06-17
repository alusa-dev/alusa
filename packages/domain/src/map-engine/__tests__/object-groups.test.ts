import { canGroupObject, getGroupMemberIds, getNextGroupDisplayName, getObjectGroupId, resolveDragTarget, resolveGroupSelectionItem, sanitizeGroupMembership, selectionHasMixedTextAndShapes, setObjectGroupData, validateGroupCandidates } from '../index';
import type { EventMapObjectDTO } from '../index';

import { describe, expect, it } from 'vitest';

function object(id: string, groupId?: string, groupLabel?: string): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'GENERAL_AREA',
    data: groupId ? { groupId, groupLabel: groupLabel ?? 'Grupo 01' } : {},
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

function textObject(id: string, groupId?: string): EventMapObjectDTO {
  return {
    ...object(id, groupId),
    type: 'TEXT',
    width: null,
    height: null,
    data: {
      ...(groupId ? { groupId, groupLabel: 'Grupo 01' } : {}),
      text: 'Título',
      fontSize: 22,
    },
  };
}

describe('object-groups', () => {
  it('resolves a grouped object click into all group members', () => {
    const objects = [object('a', 'group-1'), object('b', 'group-1'), object('c')];

    expect(resolveGroupSelectionItem({ type: 'object', id: 'a' }, objects)).toEqual([
      { type: 'object', id: 'a' },
      { type: 'object', id: 'b' },
    ]);
  });

  it('creates sequential group names', () => {
    expect(getNextGroupDisplayName([])).toBe('Grupo 01');
    expect(getNextGroupDisplayName([object('a', 'group-1', 'Grupo 01')])).toBe('Grupo 02');
    expect(getNextGroupDisplayName([object('a', 'group-1', 'Grupo 01')], 'Grupo 01')).toBe('Grupo 02');
    expect(
      getNextGroupDisplayName([object('a', 'group-1', 'Grupo 01'), object('b', 'group-2', 'Grupo 02')], 'Grupo 01'),
    ).toBe('Grupo 03');
  });

  it('clears group metadata when ungrouping', () => {
    expect(setObjectGroupData({ label: 'Retângulo 1', groupId: 'g1', groupLabel: 'Grupo 1' }, null, null)).toEqual({
      label: 'Retângulo 1',
    });
  });

  it('allows grouping only unlocked standalone objects', () => {
    expect(canGroupObject(object('a'))).toBe(true);
    expect(canGroupObject({ ...object('b'), locked: true })).toBe(false);
    expect(canGroupObject({ ...object('c'), sectionId: 'section-1' })).toBe(false);
  });

  it('lists all members of a group', () => {
    const objects = [object('a', 'group-1'), object('b', 'group-1'), object('c')];
    expect(getGroupMemberIds(objects, 'group-1')).toEqual(['a', 'b']);
  });

  it('expands drag target to all grouped objects on drag start', () => {
    const objects = [object('a', 'group-1'), object('b', 'group-1'), object('c')];
    const map = { objects, seats: [], seatGroups: [] };
    const result = resolveDragTarget('node-a', { type: 'object', id: 'a' }, [], map);

    expect(result.nodeIds).toEqual(['node-a', 'node-b']);
    expect(result.selectionItems).toEqual([
      { type: 'object', id: 'a' },
      { type: 'object', id: 'b' },
    ]);
  });

  it('preserves seat group nodes when resolving mixed drag targets', () => {
    const objects = [object('a')];
    const map = {
      objects,
      seats: [],
      seatGroups: [
        {
          id: 'group-1',
          levelId: 'level-1',
          name: 'Setor 1',
          x: 100,
          y: 100,
          rotation: 0,
          rows: 2,
          columns: 2,
          seatWidth: 20,
          seatHeight: 20,
          gapX: 10,
          gapY: 10,
          paddingTop: 8,
          paddingRight: 8,
          paddingBottom: 8,
          paddingLeft: 8,
          numbering: {},
          locked: false,
        },
      ],
    };
    const result = resolveDragTarget(
      'node-seatgroup-group-1',
      { type: 'seatgroup', id: 'group-1' },
      [
        { type: 'seatgroup', id: 'group-1' },
        { type: 'object', id: 'a' },
      ],
      map,
    );

    expect(result.nodeIds).toEqual(['node-a', 'node-seatgroup-group-1']);
    expect(result.selectionItems).toEqual([
      { type: 'object', id: 'a' },
      { type: 'seatgroup', id: 'group-1' },
    ]);
  });

  it('collapses grouped seats into the parent seat group drag target', () => {
    const objects: EventMapObjectDTO[] = [];
    const map = {
      objects,
      seatGroups: [
        {
          id: 'group-1',
          levelId: 'level-1',
          name: 'Setor 1',
          x: 100,
          y: 100,
          rotation: 0,
          rows: 2,
          columns: 2,
          seatWidth: 20,
          seatHeight: 20,
          gapX: 10,
          gapY: 10,
          paddingTop: 8,
          paddingRight: 8,
          paddingBottom: 8,
          paddingLeft: 8,
          numbering: {},
          locked: false,
        },
      ],
      seats: [
        {
          id: 'seat-1',
          levelId: 'level-1',
          sectionId: 'section-1',
          objectId: null,
          groupId: 'group-1',
          rowIndex: 0,
          columnIndex: 0,
          technicalCode: 'A-1',
          displayLabel: 'A1',
          rowLabel: 'A',
          seatNumber: '1',
          status: 'AVAILABLE',
          accessible: false,
          publicVisible: true,
          x: 118,
          y: 118,
          size: 20,
          rotation: 0,
        },
        {
          id: 'seat-2',
          levelId: 'level-1',
          sectionId: 'section-1',
          objectId: null,
          groupId: 'group-1',
          rowIndex: 0,
          columnIndex: 1,
          technicalCode: 'A-2',
          displayLabel: 'A2',
          rowLabel: 'A',
          seatNumber: '2',
          status: 'AVAILABLE',
          accessible: false,
          publicVisible: true,
          x: 148,
          y: 118,
          size: 20,
          rotation: 0,
        },
      ],
    };

    const result = resolveDragTarget(
      'node-seatgroup-group-1',
      { type: 'seatgroup', id: 'group-1' },
      [
        { type: 'seatgroup', id: 'group-1' },
        { type: 'seat', id: 'seat-1' },
        { type: 'seat', id: 'seat-2' },
      ],
      map,
    );

    expect(result.nodeIds).toEqual(['node-seatgroup-group-1']);
    expect(result.selectionItems).toEqual([{ type: 'seatgroup', id: 'group-1' }]);
  });

  it('validates group candidates and rejects mixed levels', () => {
    const objects = [object('a'), { ...object('b'), levelId: 'level-2' }];
    expect(validateGroupCandidates([{ type: 'object', id: 'a' }, { type: 'object', id: 'b' }], objects)).toEqual({
      ok: false,
      reason: 'Só é possível agrupar objetos do mesmo plano.',
    });
  });

  it('allows grouping text with shapes', () => {
    const objects = [textObject('text-1'), object('shape-1')];
    const result = validateGroupCandidates(
      [
        { type: 'object', id: 'text-1' },
        { type: 'object', id: 'shape-1' },
      ],
      objects,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates.map((entry) => entry.id)).toEqual(['text-1', 'shape-1']);
    }
  });

  it('detects mixed text and shape selections', () => {
    const objects = [textObject('text-1'), object('shape-1')];
    expect(selectionHasMixedTextAndShapes(objects, ['text-1', 'shape-1'])).toBe(true);
    expect(selectionHasMixedTextAndShapes(objects, ['shape-1'])).toBe(false);
  });

  it('ungroups orphaned members after one object is removed from a group', () => {
    const objects = sanitizeGroupMembership([object('a', 'group-1'), object('c')]);
    expect(getObjectGroupId(objects[0]!)).toBeNull();
  });
});
