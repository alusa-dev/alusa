import { describe, it, expect } from 'vitest';
import {
  createSeatGroup,
  getSeatLabel,
  deriveSeats,
  getSeatGroupLocalSize,
  getSeatLocalPosition,
} from '../../map-layout/seat-groups';
import type { SeatGroup } from '../../map-layout/seat-groups/types';

const BASE_GROUP_INPUT = {
  id: 'group-1',
  contaId: 'conta-1',
  x: 100,
  y: 200,
  rows: 3,
  columns: 4,
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

describe('createSeatGroup', () => {
  it('cria grupo e assentos com dimensões corretas', () => {
    const { group, seats } = createSeatGroup(BASE_GROUP_INPUT);
    expect(seats).toHaveLength(3 * 4);
    expect(group.rows).toBe(3);
    expect(group.columns).toBe(4);
  });

  it('gera labels estáveis: A1, A2, A3, A4, B1...', () => {
    const { seats } = createSeatGroup(BASE_GROUP_INPUT);
    const labels = seats.map((s) => s.label);
    expect(labels[0]).toBe('A1');
    expect(labels[1]).toBe('A2');
    expect(labels[3]).toBe('A4');
    expect(labels[4]).toBe('B1');
    expect(labels[11]).toBe('C4');
  });

  it('label nunca depende de posição x/y', () => {
    const { seats: seatsAt0 } = createSeatGroup({ ...BASE_GROUP_INPUT, x: 0, y: 0 });
    const { seats: seatsAt500 } = createSeatGroup({ ...BASE_GROUP_INPUT, x: 500, y: 500 });
    expect(seatsAt0.map((s) => s.label)).toEqual(seatsAt500.map((s) => s.label));
  });

  it('IDs dos assentos são determinísticos', () => {
    const { seats: a } = createSeatGroup(BASE_GROUP_INPUT);
    const { seats: b } = createSeatGroup(BASE_GROUP_INPUT);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });
});

describe('getSeatLabel — formatos', () => {
  it('formato A (padrão): A1, B2...', () => {
    expect(getSeatLabel({ rowIndex: 0, columnIndex: 0, numbering: BASE_GROUP_INPUT.numbering, totalRows: 5, totalColumns: 5 })).toBe('A1');
    expect(getSeatLabel({ rowIndex: 1, columnIndex: 2, numbering: BASE_GROUP_INPUT.numbering, totalRows: 5, totalColumns: 5 })).toBe('B3');
  });

  it('formato 01: 01, 02...', () => {
    const numbering = { ...BASE_GROUP_INPUT.numbering, rowLabelFormat: '01' as const };
    expect(getSeatLabel({ rowIndex: 0, columnIndex: 0, numbering, totalRows: 5, totalColumns: 5 })).toBe('011');
  });

  it('direção invertida: colunas RIGHT_TO_LEFT', () => {
    const numbering = { ...BASE_GROUP_INPUT.numbering, columnDirection: 'RIGHT_TO_LEFT' as const };
    const label = getSeatLabel({ rowIndex: 0, columnIndex: 0, numbering, totalRows: 3, totalColumns: 4 });
    // columnIndex 0 com RIGHT_TO_LEFT e 4 colunas → seatNum = 1 + (4-1-0) = 4
    expect(label).toBe('A4');
  });
});

describe('getSeatGroupLocalSize', () => {
  it('calcula tamanho correto sem padding', () => {
    const { group } = createSeatGroup(BASE_GROUP_INPUT);
    const size = getSeatGroupLocalSize(group);
    // 4 cols * 28 + 3 gaps * 4 = 112 + 12 = 124
    expect(size.width).toBe(124);
    // 3 rows * 28 + 2 gaps * 4 = 84 + 8 = 92
    expect(size.height).toBe(92);
  });

  it('inclui padding no tamanho total', () => {
    const { group } = createSeatGroup({ ...BASE_GROUP_INPUT, paddingTop: 10, paddingLeft: 10, paddingBottom: 10, paddingRight: 10 });
    const size = getSeatGroupLocalSize(group);
    expect(size.width).toBe(124 + 20);
    expect(size.height).toBe(92 + 20);
  });
});

describe('getSeatLocalPosition', () => {
  it('calcula posição local correta para r0c0', () => {
    const { group } = createSeatGroup(BASE_GROUP_INPUT);
    const pos = getSeatLocalPosition({ rowIndex: 0, columnIndex: 0, group });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('calcula posição local correta para r1c2', () => {
    const { group } = createSeatGroup(BASE_GROUP_INPUT);
    // x = 2 * (28 + 4) = 64, y = 1 * (28 + 4) = 32
    const pos = getSeatLocalPosition({ rowIndex: 1, columnIndex: 2, group });
    expect(pos.x).toBe(64);
    expect(pos.y).toBe(32);
  });
});

describe('deriveSeats', () => {
  it('visualX/Y = group.x + localPos', () => {
    const { group, seats } = createSeatGroup(BASE_GROUP_INPUT);
    const derived = deriveSeats(group, seats);
    const first = derived[0];
    expect(first.visualX).toBe(100); // group.x + 0
    expect(first.visualY).toBe(200); // group.y + 0
  });

  it('aplica corridorOffset sem mutar seat.x/y', () => {
    const { group, seats } = createSeatGroup(BASE_GROUP_INPUT);
    const seatId = seats[0].id;
    const impacts = [
      {
        corridorId: 'c1',
        offsetsBySeatId: new Map([[seatId, { dx: 10, dy: 0 }]]),
        hiddenSeatIds: new Set<string>(),
        warnings: [],
      },
    ];
    const derived = deriveSeats(group, seats, impacts);
    const first = derived.find((s) => s.id === seatId)!;
    expect(first.visualX).toBe(110); // +10 offset
    // seat original não foi mutado
    const original = seats.find((s) => s.id === seatId)!;
    expect('x' in original).toBe(false); // seat não tem x/y — posição deriva
    expect(first.corridorOffset).toEqual({ dx: 10, dy: 0 });
  });

  it('marca hidden quando status === HIDDEN_BY_CORRIDOR', () => {
    const { group, seats } = createSeatGroup(BASE_GROUP_INPUT);
    const modified = seats.map((s, i) => i === 0 ? { ...s, status: 'HIDDEN_BY_CORRIDOR' as const } : s);
    const derived = deriveSeats(group, modified);
    expect(derived[0].hidden).toBe(true);
    expect(derived[1].hidden).toBe(false);
  });
});
