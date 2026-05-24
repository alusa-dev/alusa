import type { Bounds, ID } from '../geometry/types.js';

export type SmartCorridorAxis = 'VERTICAL' | 'HORIZONTAL';

export type CorridorBehavior =
  | 'PUSH_SEATS'    // desloca assentos para os lados
  | 'HIDE_SEATS'    // oculta assentos dentro do corredor
  | 'BLOCK_ONLY'    // apenas bloqueia passagem visual, sem mover assentos
  | 'SPLIT_VISUAL_BLOCKS'; // divide assentos em dois blocos visuais com gap

export type SmartCorridor = {
  id: ID;
  contaId: ID;
  levelId: ID;
  x: number;
  y: number;
  /** largura do corredor perpendicular ao eixo */
  thickness: number;
  /** comprimento do corredor ao longo do eixo */
  length: number;
  /** graus; restrito a 0 / 90 / 180 / 270 para MVP */
  rotation: number;
  axis: SmartCorridorAxis;
  behavior: CorridorBehavior;
  clearance: number;
  locked?: boolean;
};

/**
 * Impacto calculado de um corredor sobre os assentos.
 * NUNCA persistir — derivado em runtime a partir de SmartCorridor + SeatGroup[].
 */
export type CorridorImpact = {
  corridorId: ID;
  /** seatId → offset visual (não muda a posição base do assento) */
  offsetsBySeatId: Map<ID, { dx: number; dy: number }>;
  /** IDs de assentos ocultos por este corredor */
  hiddenSeatIds: Set<ID>;
  warnings: CorridorWarning[];
};

export type CorridorWarning = {
  code:
    | 'SEAT_IN_CLEARANCE_ZONE'
    | 'CORRIDOR_OVERLAP'
    | 'SEAT_COMPLETELY_BLOCKED';
  message: string;
  seatIds?: ID[];
};

/** Bloco visual de assentos deslocados por um lado do corredor. */
export type VisualSeatBlock = {
  seatIds: ID[];
  side: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
  offset: number;
};

export type CorridorAttachment = {
  corridorId: ID;
  attachedToObjectId: ID;
  attachedToKind: 'SEAT_GROUP' | 'WALL';
  edge: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
  offsetFromEdge: number;
};

function polygonAABB(points: Array<{ x: number; y: number }>): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rotateCorridorCorners(corridor: SmartCorridor, clearance: number): Array<{ x: number; y: number }> {
  const rad = (corridor.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cl = clearance;
  const corners = [
    { x: -cl, y: -cl },
    { x: corridor.length + cl, y: -cl },
    { x: corridor.length + cl, y: corridor.thickness + cl },
    { x: -cl, y: corridor.thickness + cl },
  ];
  return corners.map(({ x, y }) => ({
    x: corridor.x + x * cos - y * sin,
    y: corridor.y + x * sin + y * cos,
  }));
}

/** AABB do corredor expandido pelo clearance — leva rotação em conta. */
export function getCorridorClearanceBounds(corridor: SmartCorridor): Bounds {
  return polygonAABB(rotateCorridorCorners(corridor, corridor.clearance));
}

/** AABB do corredor sem clearance — leva rotação em conta. */
export function getCorridorCoreBounds(corridor: SmartCorridor): Bounds {
  return polygonAABB(rotateCorridorCorners(corridor, 0));
}
