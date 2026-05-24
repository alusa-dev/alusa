import { describe, it, expect } from 'vitest';
import {
  applyMapOperation,
} from '../../map-layout/operations/apply-map-operation';
import { createEmptyMapLayoutState } from '../../map-layout/state/types';
import { createSeatGroup } from '../../map-layout/seat-groups';
import type { MapLayoutState } from '../../map-layout/state/types';
import type { SmartCorridor } from '../../map-layout/corridors/types';

const GROUP_INPUT = {
  id: 'group-1',
  contaId: 'conta-1',
  x: 0,
  y: 0,
  rows: 2,
  columns: 2,
  seatWidth: 28,
  seatHeight: 28,
  gapX: 4,
  gapY: 4,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  numbering: {
    mode: 'ROW_MAJOR' as const,
    rowLabelStart: 'A',
    seatNumberStart: 1,
    rowDirection: 'TOP_TO_BOTTOM' as const,
    columnDirection: 'LEFT_TO_RIGHT' as const,
    rowLabelFormat: 'A' as const,
    separator: '',
  },
};

function buildStateWithGroup(): { state: MapLayoutState; group: ReturnType<typeof createSeatGroup>['group'] } {
  const { group, seats } = createSeatGroup(GROUP_INPUT);
  let state = createEmptyMapLayoutState('map-1', 'level-1');

  const seatsMap = new Map(state.seats);
  for (const s of seats) seatsMap.set(s.id, s);
  state = {
    ...state,
    seatGroups: new Map([[group.id, group]]),
    seats: seatsMap,
  };
  return { state, group };
}

describe('applyMapOperation — SeatGroup', () => {
  it('CREATE_SEAT_GROUP: adiciona grupo e assentos ao estado', () => {
    const { group, seats } = createSeatGroup(GROUP_INPUT);
    let state = createEmptyMapLayoutState('map-1', 'level-1');

    const seatsMap = new Map(state.seats);
    for (const s of seats) seatsMap.set(s.id, s);
    state = { ...state, seats: seatsMap };

    const { state: next, warnings } = applyMapOperation(state, { kind: 'CREATE_SEAT_GROUP', group });
    expect(warnings).toHaveLength(0);
    expect(next.seatGroups.has(group.id)).toBe(true);
  });

  it('MOVE_SEAT_GROUP: atualiza x/y sem mutar o estado anterior', () => {
    const { state, group } = buildStateWithGroup();

    const { state: next } = applyMapOperation(state, {
      kind: 'MOVE_SEAT_GROUP',
      groupId: group.id,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
    });

    expect(next.seatGroups.get(group.id)!.x).toBe(100);
    expect(next.seatGroups.get(group.id)!.y).toBe(200);
    // imutabilidade: estado anterior intacto
    expect(state.seatGroups.get(group.id)!.x).toBe(0);
  });

  it('MOVE_SEAT_GROUP: retorna warning se grupo não existe', () => {
    const state = createEmptyMapLayoutState('map-1', 'level-1');
    const { warnings } = applyMapOperation(state, {
      kind: 'MOVE_SEAT_GROUP',
      groupId: 'nao-existe',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
    });
    expect(warnings[0].code).toContain('SEAT_GROUP_NOT_FOUND');
  });

  it('DELETE_SEAT_GROUP: remove grupo e seus assentos', () => {
    const { state, group } = buildStateWithGroup();
    const seatCount = [...state.seats.values()].filter((s) => s.groupId === group.id).length;
    expect(seatCount).toBeGreaterThan(0);

    const { state: next } = applyMapOperation(state, { kind: 'DELETE_SEAT_GROUP', groupId: group.id });
    expect(next.seatGroups.has(group.id)).toBe(false);
    const remaining = [...next.seats.values()].filter((s) => s.groupId === group.id);
    expect(remaining).toHaveLength(0);
  });

  it('RELABEL_SEAT_GROUP: re-gera labels com nova config', () => {
    const { state, group } = buildStateWithGroup();
    const { state: next } = applyMapOperation(state, {
      kind: 'RELABEL_SEAT_GROUP',
      groupId: group.id,
      numbering: {
        mode: 'ROW_MAJOR',
        rowLabelStart: 'A',
        seatNumberStart: 10,
        rowDirection: 'TOP_TO_BOTTOM',
        columnDirection: 'LEFT_TO_RIGHT',
        rowLabelFormat: 'A',
        separator: '-',
      },
    });
    const seats = [...next.seats.values()].filter((s) => s.groupId === group.id);
    expect(seats[0].label).toBe('A-10');
    expect(seats[1].label).toBe('A-11');
  });
});

describe('applyMapOperation — Corridors', () => {
  const CORRIDOR: SmartCorridor = {
    id: 'c-1',
    contaId: 'conta-1',
    levelId: 'level-1',
    x: 10,
    y: 20,
    thickness: 32,
    length: 200,
    rotation: 0,
    axis: 'HORIZONTAL',
    behavior: 'PUSH_SEATS',
    clearance: 8,
  };

  it('CREATE_CORRIDOR: normaliza e adiciona corredor', () => {
    const state = createEmptyMapLayoutState('map-1', 'level-1');
    const { state: next } = applyMapOperation(state, { kind: 'CREATE_CORRIDOR', corridor: { ...CORRIDOR, rotation: 87 } });
    expect(next.corridors.has(CORRIDOR.id)).toBe(true);
    // deve normalizar rotation
    expect(next.corridors.get(CORRIDOR.id)!.rotation).toBe(90);
  });

  it('MOVE_CORRIDOR: atualiza posição', () => {
    let state = createEmptyMapLayoutState('map-1', 'level-1');
    const { state: withCorridor } = applyMapOperation(state, { kind: 'CREATE_CORRIDOR', corridor: CORRIDOR });
    state = withCorridor;

    const { state: moved } = applyMapOperation(state, {
      kind: 'MOVE_CORRIDOR',
      corridorId: CORRIDOR.id,
      from: { x: 10, y: 20 },
      to: { x: 50, y: 60 },
    });
    expect(moved.corridors.get(CORRIDOR.id)!.x).toBe(50);
    expect(moved.corridors.get(CORRIDOR.id)!.y).toBe(60);
  });

  it('DELETE_CORRIDOR: remove corredor', () => {
    let state = createEmptyMapLayoutState('map-1', 'level-1');
    const { state: withCorridor } = applyMapOperation(state, { kind: 'CREATE_CORRIDOR', corridor: CORRIDOR });
    state = withCorridor;

    const { state: after } = applyMapOperation(state, { kind: 'DELETE_CORRIDOR', corridorId: CORRIDOR.id });
    expect(after.corridors.has(CORRIDOR.id)).toBe(false);
    // imutabilidade: estado com corredor intacto
    expect(state.corridors.has(CORRIDOR.id)).toBe(true);
  });
});
