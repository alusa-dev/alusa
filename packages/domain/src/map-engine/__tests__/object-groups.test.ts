import {
  canGroupObject,
  getGroupMemberIds,
  getNextGroupDisplayName,
  resolveGroupSelectionItem,
  setObjectGroupData,
  validateGroupCandidates,
} from '../index';
import type { EventMapObjectDTO } from '../index';
import { describe, expect, it } from 'vitest';

function object(id: string, groupId?: string, groupLabel?: string): EventMapObjectDTO {
  return {
    id, levelId: 'level-1', sectionId: null, type: 'GENERAL_AREA',
    data: groupId ? { groupId, groupLabel: groupLabel ?? 'Grupo 01' } : {},
    x: 0, y: 0, width: 100, height: 80, rotation: 0, locked: false, hidden: false, sortOrder: 0,
  };
}

describe('object-groups', () => {
  it('expands a grouped visual object selection', () => {
    expect(resolveGroupSelectionItem({ type: 'object', id: 'a' }, [object('a', 'g1'), object('b', 'g1'), object('c')])).toEqual([
      { type: 'object', id: 'a' }, { type: 'object', id: 'b' },
    ]);
  });

  it('creates sequential names and lists members', () => {
    const objects = [object('a', 'g1', 'Grupo 01'), object('b', 'g2', 'Grupo 02')];
    expect(getNextGroupDisplayName([])).toBe('Grupo 01');
    expect(getNextGroupDisplayName(objects)).toBe('Grupo 03');
    expect(getGroupMemberIds(objects, 'g1')).toEqual(['a']);
  });

  it('clears metadata and rejects locked or section-linked objects', () => {
    expect(setObjectGroupData({ label: 'Forma', groupId: 'g1', groupLabel: 'Grupo 1' }, null, null)).toEqual({ label: 'Forma' });
    expect(canGroupObject(object('a'))).toBe(true);
    expect(canGroupObject({ ...object('b'), locked: true })).toBe(false);
    expect(canGroupObject({ ...object('c'), sectionId: 'section-1' })).toBe(false);
  });

  it('requires grouped visual objects to share a level', () => {
    expect(validateGroupCandidates([{ type: 'object', id: 'a' }, { type: 'object', id: 'b' }], [
      object('a'), { ...object('b'), levelId: 'level-2' },
    ])).toEqual({ ok: false, reason: 'Só é possível agrupar objetos do mesmo plano.' });
  });
});
