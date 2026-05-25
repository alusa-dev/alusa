import type { EventMapDTO, EventSeatDTO } from '../types/event-map-types.js';

export type MapValidationError = {
  type: 'seat-overlap' | 'seat-no-section' | 'section-no-lot';
  severity: 'error' | 'warning';
  message: string;
  ids: string[]; // affected entity IDs
};

export type MapValidationResult = {
  valid: boolean;
  errors: MapValidationError[];
};

export function validateEventMapIntegrity(map: EventMapDTO): MapValidationResult {
  const errors: MapValidationError[] = [];

  const sectionIds = new Set(map.sections.map((s) => s.id));

  // 1. Seat Without Section (Assentos sem setor válido)
  const orphanSeatIds: string[] = [];
  for (const seat of map.seats) {
    if (!seat.sectionId || !sectionIds.has(seat.sectionId)) {
      orphanSeatIds.push(seat.id);
    }
  }

  if (orphanSeatIds.length > 0) {
    errors.push({
      type: 'seat-no-section',
      severity: 'error',
      message: `${orphanSeatIds.length} assento(s) sem setor associado.`,
      ids: orphanSeatIds,
    });
  }

  // 2. Active Section Without Ticket Lot (Setores ativos sem lotes)
  const activeSectionsWithoutLot: string[] = [];
  for (const section of map.sections) {
    if (section.status === 'ACTIVE' && !section.lotId) {
      activeSectionsWithoutLot.push(section.id);
    }
  }

  if (activeSectionsWithoutLot.length > 0) {
    errors.push({
      type: 'section-no-lot',
      severity: 'warning',
      message: `${activeSectionsWithoutLot.length} setor(es) ativo(s) sem lote de ingressos vinculado.`,
      ids: activeSectionsWithoutLot,
    });
  }

  // 3. Seat Overlap (Assentos sobrepostos no mesmo nível)
  // Group seats by level
  const seatsByLevel = new Map<string, EventSeatDTO[]>();
  for (const seat of map.seats) {
    const list = seatsByLevel.get(seat.levelId) || [];
    list.push(seat);
    seatsByLevel.set(seat.levelId, list);
  }

  const overlappingSeatIds = new Set<string>();

  for (const seats of seatsByLevel.values()) {
    // Sort seats by x to use a sweep-line optimization
    const sortedSeats = [...seats].sort((a, b) => a.x - b.x);

    for (let i = 0; i < sortedSeats.length; i++) {
      const seatA = sortedSeats[i]!;
      const sizeA = seatA.size ?? 24;
      const radiusA = sizeA / 2;

      for (let j = i + 1; j < sortedSeats.length; j++) {
        const seatB = sortedSeats[j]!;
        const sizeB = seatB.size ?? 24;
        const radiusB = sizeB / 2;

        // Since sorted by x, if difference in x is >= sum of radii, we can stop checking further seats
        const threshold = radiusA + radiusB - 0.01;
        if (seatB.x - seatA.x >= threshold) {
          break;
        }

        // Calculate actual Euclidean distance
        const dx = seatB.x - seatA.x;
        const dy = seatB.y - seatA.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < threshold) {
          overlappingSeatIds.add(seatA.id);
          overlappingSeatIds.add(seatB.id);
        }
      }
    }
  }

  if (overlappingSeatIds.size > 0) {
    errors.push({
      type: 'seat-overlap',
      severity: 'error',
      message: `${overlappingSeatIds.size} assento(s) sobreposto(s) detectado(s).`,
      ids: Array.from(overlappingSeatIds),
    });
  }

  return {
    valid: errors.every((err) => err.severity !== 'error'),
    errors,
  };
}
