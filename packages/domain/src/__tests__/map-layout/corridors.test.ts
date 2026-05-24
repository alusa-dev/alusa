import { describe, it, expect } from 'vitest';
import { normalizeCorridor, snapSmartCorridorRotation, classifyCorridorAxis } from '../../map-layout/corridors/normalize-corridor';
import { corridorToPolygon } from '../../map-layout/corridors/corridor-to-polygon';
import { corridorPolygonsIntersect } from '../../map-layout/corridors/merge-corridors';
import { detectCorridorImpact } from '../../map-layout/corridors/detect-corridor-impact';
import { createSeatGroup } from '../../map-layout/seat-groups';
import type { SmartCorridor } from '../../map-layout/corridors/types';

const BASE_CORRIDOR: SmartCorridor = {
  id: 'c1',
  contaId: 'conta-1',
  levelId: 'level-1',
  x: 50,
  y: 100,
  thickness: 32,
  length: 200,
  rotation: 0,
  axis: 'HORIZONTAL',
  behavior: 'PUSH_SEATS',
  clearance: 8,
};

describe('snapSmartCorridorRotation', () => {
  it('retorna 0 para ângulos próximos de 0', () => {
    expect(snapSmartCorridorRotation(10)).toBe(0);
    expect(snapSmartCorridorRotation(350)).toBe(0);
    expect(snapSmartCorridorRotation(0)).toBe(0);
  });

  it('retorna 90 para ângulos próximos de 90', () => {
    expect(snapSmartCorridorRotation(85)).toBe(90);
    expect(snapSmartCorridorRotation(95)).toBe(90);
  });

  it('invariante MVP: apenas 0/90/180/270 são válidos', () => {
    const valid = [0, 90, 180, 270];
    for (let deg = 0; deg < 360; deg += 5) {
      expect(valid).toContain(snapSmartCorridorRotation(deg));
    }
  });
});

describe('classifyCorridorAxis', () => {
  it('0° → HORIZONTAL', () => expect(classifyCorridorAxis(0)).toBe('HORIZONTAL'));
  it('180° → HORIZONTAL', () => expect(classifyCorridorAxis(180)).toBe('HORIZONTAL'));
  it('90° → VERTICAL', () => expect(classifyCorridorAxis(90)).toBe('VERTICAL'));
  it('270° → VERTICAL', () => expect(classifyCorridorAxis(270)).toBe('VERTICAL'));
});

describe('normalizeCorridor', () => {
  it('normaliza rotação e recalcula axis', () => {
    const result = normalizeCorridor({ ...BASE_CORRIDOR, rotation: 87 });
    expect(result.rotation).toBe(90);
    expect(result.axis).toBe('VERTICAL');
  });

  it('garante thickness >= 1', () => {
    expect(normalizeCorridor({ ...BASE_CORRIDOR, thickness: 0 }).thickness).toBe(1);
  });
});

describe('corridorToPolygon', () => {
  it('retorna 4 pontos para corredor sem rotação', () => {
    const poly = corridorToPolygon(BASE_CORRIDOR);
    expect(poly).toHaveLength(4);
  });

  it('bounding box do polígono é consistente com x/y/length/thickness', () => {
    const poly = corridorToPolygon({ ...BASE_CORRIDOR, rotation: 0 });
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(BASE_CORRIDOR.x);
    expect(Math.min(...ys)).toBeCloseTo(BASE_CORRIDOR.y);
    expect(Math.max(...xs)).toBeCloseTo(BASE_CORRIDOR.x + BASE_CORRIDOR.length);
    expect(Math.max(...ys)).toBeCloseTo(BASE_CORRIDOR.y + BASE_CORRIDOR.thickness);
  });
});

describe('corridorPolygonsIntersect', () => {
  it('detecta sobreposição entre dois corredores sobrepostos', () => {
    const a: SmartCorridor = { ...BASE_CORRIDOR, id: 'ca', x: 0, y: 0, length: 100, thickness: 20 };
    const b: SmartCorridor = { ...BASE_CORRIDOR, id: 'cb', x: 50, y: 0, length: 100, thickness: 20 };
    expect(corridorPolygonsIntersect(a, b)).toBe(true);
  });

  it('retorna false para corredores separados', () => {
    const a: SmartCorridor = { ...BASE_CORRIDOR, id: 'ca', x: 0, y: 0, length: 40, thickness: 20 };
    const b: SmartCorridor = { ...BASE_CORRIDOR, id: 'cb', x: 60, y: 0, length: 40, thickness: 20 };
    expect(corridorPolygonsIntersect(a, b)).toBe(false);
  });
});

describe('detectCorridorImpact — PUSH_SEATS', () => {
  const GROUP_INPUT = {
    id: 'group-1',
    contaId: 'conta-1',
    x: 0,
    y: 0,
    rows: 4,
    columns: 1,
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

  it('PUSH_SEATS gera offsets sem mutar o seat', () => {
    const { group, seats } = createSeatGroup(GROUP_INPUT);
    // corredor horizontal no meio do grupo
    const corridor: SmartCorridor = {
      ...BASE_CORRIDOR,
      id: 'c-push',
      x: 0,
      y: 60, // entre assento[1] (y=32) e assento[2] (y=64)
      thickness: 20,
      length: 200,
      clearance: 4,
      behavior: 'PUSH_SEATS',
    };

    const impact = detectCorridorImpact(corridor, [{ group, seats }]);
    expect(impact.corridorId).toBe('c-push');
    expect(impact.hiddenSeatIds.size).toBe(0);
    // Não deve mutar seats
    for (const seat of seats) {
      expect('x' in seat).toBe(false);
    }
  });

  it('HIDE_SEATS oculta assentos dentro do corredor', () => {
    const { group, seats } = createSeatGroup(GROUP_INPUT);
    const corridor: SmartCorridor = {
      ...BASE_CORRIDOR,
      id: 'c-hide',
      x: -10,
      y: 60,
      thickness: 40,
      length: 100,
      clearance: 0,
      behavior: 'HIDE_SEATS',
    };

    const impact = detectCorridorImpact(corridor, [{ group, seats }]);
    // deve haver assentos ocultos
    expect(impact.hiddenSeatIds.size).toBeGreaterThanOrEqual(1);
  });

  it('idempotente — mesmo input gera mesmo output', () => {
    const { group, seats } = createSeatGroup(GROUP_INPUT);
    const corridor: SmartCorridor = {
      ...BASE_CORRIDOR,
      id: 'c-idemp',
      behavior: 'PUSH_SEATS',
    };

    const a = detectCorridorImpact(corridor, [{ group, seats }]);
    const b = detectCorridorImpact(corridor, [{ group, seats }]);
    expect(a.offsetsBySeatId.size).toBe(b.offsetsBySeatId.size);
  });
});
