import type { ID } from '../geometry/types.js';
import type { SeatGroup } from '../seat-groups/types.js';
import type { CorridorImpact, SmartCorridor } from './types.js';
import { getCorridorClearanceBounds, getCorridorCoreBounds } from './types.js';
import { corridorToPolygon, corridorClearanceToPolygon } from './corridor-to-polygon.js';
import { pointInPolygon, polygonsIntersect } from '../geometry/collision.js';
import { boundsToSpatialItem, buildSpatialIndex, findCandidateItems } from '../geometry/spatial-index.js';
import { getSeatLocalPosition } from '../seat-groups/derive-seats.js';
import type { SpatialItem } from '../geometry/spatial-index.js';

type SeatRef = {
  seat: { id: ID; rowIndex: number; columnIndex: number; status: string };
  group: SeatGroup;
};

/** Calcula o impacto de um corredor sobre todos os assentos dos grupos informados. */
export function detectCorridorImpact(
  corridor: SmartCorridor,
  groups: { group: SeatGroup; seats: SeatRef['seat'][] }[],
): CorridorImpact {
  const offsetsBySeatId = new Map<ID, { dx: number; dy: number }>();
  const hiddenSeatIds = new Set<ID>();
  const warnings: CorridorImpact['warnings'] = [];

  const corridorPoly = corridorToPolygon(corridor);
  const clearancePoly = corridorClearanceToPolygon(corridor);
  const clearanceBounds = getCorridorClearanceBounds(corridor);

  // Spatial index de todos os assentos
  const allSeatItems: SpatialItem[] = [];
  for (const { group, seats } of groups) {
    for (const seat of seats) {
      const local = getSeatLocalPosition({
        rowIndex: seat.rowIndex,
        columnIndex: seat.columnIndex,
        group,
      });
      allSeatItems.push(
        boundsToSpatialItem(
          {
            x: group.x + local.x,
            y: group.y + local.y,
            width: group.seatWidth,
            height: group.seatHeight,
          },
          seat.id,
          'SEAT',
        ),
      );
    }
  }

  const spatialIndex = buildSpatialIndex(allSeatItems);
  const candidates = findCandidateItems(spatialIndex, clearanceBounds);
  const candidateIds = new Set(candidates.map((c) => c.id));

  for (const { group, seats } of groups) {
    // Separa assentos em dois blocos: esquerda/cima e direita/baixo do corredor
    const leftSeats: SeatRef['seat'][] = [];
    const rightSeats: SeatRef['seat'][] = [];

    for (const seat of seats) {
      if (!candidateIds.has(seat.id)) continue;

      const local = getSeatLocalPosition({
        rowIndex: seat.rowIndex,
        columnIndex: seat.columnIndex,
        group,
      });
      const seatCenter = {
        x: group.x + local.x + group.seatWidth / 2,
        y: group.y + local.y + group.seatHeight / 2,
      };

      const inCore = pointInPolygon(seatCenter, corridorPoly);
      const inClearance = pointInPolygon(seatCenter, clearancePoly);

      if (corridor.behavior === 'HIDE_SEATS' && inCore) {
        hiddenSeatIds.add(seat.id);
        continue;
      }

      if (corridor.behavior === 'PUSH_SEATS' && (inCore || inClearance)) {
        const coreBounds = getCorridorCoreBounds(corridor);
        const corridorCenter = {
          x: coreBounds.x + coreBounds.width / 2,
          y: coreBounds.y + coreBounds.height / 2,
        };

        if (corridor.axis === 'HORIZONTAL') {
          if (seatCenter.y < corridorCenter.y) leftSeats.push(seat);
          else rightSeats.push(seat);
        } else {
          if (seatCenter.x < corridorCenter.x) leftSeats.push(seat);
          else rightSeats.push(seat);
        }
      }
    }

    // Calcula o offset de push
    if (corridor.behavior === 'PUSH_SEATS') {
      const halfPush = (corridor.thickness / 2 + corridor.clearance);

      for (const seat of leftSeats) {
        const existing = offsetsBySeatId.get(seat.id) ?? { dx: 0, dy: 0 };
        if (corridor.axis === 'HORIZONTAL') {
          offsetsBySeatId.set(seat.id, { dx: existing.dx, dy: existing.dy - halfPush });
        } else {
          offsetsBySeatId.set(seat.id, { dx: existing.dx - halfPush, dy: existing.dy });
        }
      }
      for (const seat of rightSeats) {
        const existing = offsetsBySeatId.get(seat.id) ?? { dx: 0, dy: 0 };
        if (corridor.axis === 'HORIZONTAL') {
          offsetsBySeatId.set(seat.id, { dx: existing.dx, dy: existing.dy + halfPush });
        } else {
          offsetsBySeatId.set(seat.id, { dx: existing.dx + halfPush, dy: existing.dy });
        }
      }
    }
  }

  return {
    corridorId: corridor.id,
    offsetsBySeatId,
    hiddenSeatIds,
    warnings,
  };
}

/** Calcula impactos de todos os corredores de uma vez.
 *  Corredores que se intersectam são tratados como cluster para evitar duplo-deslocamento.
 */
export function calculateAllCorridorImpacts(
  corridors: SmartCorridor[],
  groups: { group: SeatGroup; seats: SeatRef['seat'][] }[],
): CorridorImpact[] {
  if (corridors.length === 0) return [];

  // Cluster de corredores intersectantes (union-find simples)
  const polygons = corridors.map((c) => corridorClearanceToPolygon(c));
  const parent = corridors.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number) {
    parent[find(a)] = find(b);
  }

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      if (polygonsIntersect(polygons[i]!, polygons[j]!)) {
        union(i, j);
      }
    }
  }

  // Agrupa por cluster
  const clusters = new Map<number, SmartCorridor[]>();
  for (let i = 0; i < corridors.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(corridors[i]!);
  }

  const results: CorridorImpact[] = [];

  for (const clusterCorridors of clusters.values()) {
    if (clusterCorridors.length === 1) {
      results.push(detectCorridorImpact(clusterCorridors[0]!, groups));
      continue;
    }

    // Clusters intersectantes: merge impactos — cada assento é atribuído ao corredor mais próximo
    // para evitar que múltiplos corredores do cluster o deslocem independentemente.
    const impacts = clusterCorridors.map((c) => detectCorridorImpact(c, groups));

    // Collect all unique seatIds affected
    const allSeatIds = new Set<ID>();
    for (const impact of impacts) {
      for (const id of impact.offsetsBySeatId.keys()) allSeatIds.add(id);
      for (const id of impact.hiddenSeatIds) allSeatIds.add(id);
    }

    // Merged impact — attributed to the first corridor of the cluster (representative)
    const mergedOffsets = new Map<ID, { dx: number; dy: number }>();
    const mergedHidden = new Set<ID>();
    const mergedWarnings: CorridorImpact['warnings'] = [];

    for (const seatId of allSeatIds) {
      let maxDx = 0, maxDy = 0;
      let hidden = false;
      for (const impact of impacts) {
        if (impact.hiddenSeatIds.has(seatId)) { hidden = true; break; }
        const off = impact.offsetsBySeatId.get(seatId);
        if (off) {
          // Take the larger absolute displacement per axis (not additive)
          if (Math.abs(off.dx) > Math.abs(maxDx)) maxDx = off.dx;
          if (Math.abs(off.dy) > Math.abs(maxDy)) maxDy = off.dy;
        }
      }
      if (hidden) {
        mergedHidden.add(seatId);
      } else if (maxDx !== 0 || maxDy !== 0) {
        mergedOffsets.set(seatId, { dx: maxDx, dy: maxDy });
      }
    }

    for (const impact of impacts) {
      mergedWarnings.push(...impact.warnings);
    }

    results.push({
      corridorId: clusterCorridors[0]!.id,
      offsetsBySeatId: mergedOffsets,
      hiddenSeatIds: mergedHidden,
      warnings: mergedWarnings,
    });
  }

  return results;
}
