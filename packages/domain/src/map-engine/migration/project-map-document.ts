import { sectionLocalToWorld } from '../geometry/map-coordinate-transform.js';
import { resolveEventMapLayout } from '../layout/resolve-map-layout.js';
import type { EventMapDocument } from '../model/event-map-document.js';
import type { EventMapObjectDTO, EventMapSectionDTO, EventSeatDTO } from '../types/event-map-types.js';

export function projectMapDocumentToEditorFields(
  document: EventMapDocument,
  previous?: {
    sections?: EventMapSectionDTO[];
    seats?: EventSeatDTO[];
  },
) {
  const layout = resolveEventMapLayout(document);
  const previousSections = new Map((previous?.sections ?? []).map((section) => [section.id, section]));
  const previousSeats = new Map((previous?.seats ?? []).map((seat) => [seat.id, seat]));
  const sections = document.sections.map((section): EventMapSectionDTO => {
    const previousSection = previousSections.get(section.id);
    return {
      id: section.id,
      levelId: section.levelId,
      lotId: section.lotId ?? previousSection?.lotId ?? null,
      lot: previousSection?.lot ?? null,
      name: section.name,
      color: section.color,
      capacity: section.capacity ?? null,
      status: section.status ?? 'ACTIVE',
      notes: section.notes ?? null,
      hidden: section.hidden ?? false,
    };
  });
  const sectionById = new Map(document.sections.map((section) => [section.id, section]));
  const seats = layout.seats.map((placement): EventSeatDTO => {
    const section = sectionById.get(placement.sectionId)!;
    const previousSeat = previousSeats.get(placement.seatId);
    const world = sectionLocalToWorld({ x: placement.x, y: placement.y }, section.position, section.rotation);
    return {
      id: placement.seatId,
      levelId: placement.levelId,
      sectionId: placement.sectionId,
      objectId: null,
      rowIndex: placement.rowIndex,
      columnIndex: placement.columnIndex,
      technicalCode: placement.technicalCode,
      displayLabel: placement.label,
      rowLabel: placement.rowLabel,
      seatNumber: placement.seatNumber,
      status: previousSeat?.status ?? 'AVAILABLE',
      accessible: placement.accessible,
      publicVisible: placement.publicVisible,
      x: world.x,
      y: world.y,
      size: placement.size,
      rotation: placement.rotation + section.rotation,
    };
  });
  const objects = document.visualElements as EventMapObjectDTO[];
  return { sections, objects, seats, layout };
}
