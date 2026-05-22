import { describe, expect, it } from 'vitest';

import type { EventMapObjectDTO } from '../api/event-map-service';
import {
  canGroupObject,
  getGroupMemberIds,
  getObjectGroupId,
  getNextGroupDisplayName,
  resolveDragTarget,
  resolveGroupSelectionItem,
  sanitizeGroupMembership,
  selectionHasMixedTextAndShapes,
  setObjectGroupData,
  validateGroupCandidates,
} from '../lib/object-groups';

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
    const result = resolveDragTarget('node-a', { type: 'object', id: 'a' }, [], objects);

    expect(result.nodeIds).toEqual(['node-a', 'node-b']);
    expect(result.selectionItems).toEqual([
      { type: 'object', id: 'a' },
      { type: 'object', id: 'b' },
    ]);
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
