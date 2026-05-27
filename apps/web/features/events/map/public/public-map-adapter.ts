import type { EventMapDTO } from '@alusa/domain';
import type { PublicEventMapDTO } from '@alusa/lib/events/map/event-map.service';

export type PublicMapViewModel = PublicEventMapDTO;

export function buildPreviewPublicMap(map: EventMapDTO): PublicMapViewModel {
  return {
    publicSlug: map.publicSlug ?? `preview-${map.id}`,
    publicUrl: `/events/${map.eventId}/maps/${map.id}/preview`,
    mapId: map.id,
    versionId: map.publishedVersionId ?? 'draft-preview',
    version: map.versions[0]?.version ?? 0,
    name: map.name,
    publishedAt: map.publishedAt ?? new Date().toISOString(),
    event: {
      id: map.event.id,
      name: map.event.name,
      startsAt: map.event.startsAt,
      endsAt: null,
      locationName: null,
      locationAddress: null,
      status: map.event.status as PublicMapViewModel['event']['status'],
    },
    levels: map.levels,
    sections: map.sections,
    objects: map.objects,
    seatGroups: map.seatGroups,
    seats: map.seats
      .filter((seat) => seat.publicVisible)
      .map((seat) => {
        const section = map.sections.find((entry) => entry.id === seat.sectionId);
        return {
          id: seat.id,
          originalSeatId: seat.id,
          levelId: seat.levelId,
          sectionId: seat.sectionId,
          sectionName: section?.name ?? 'Setor',
          lotId: section?.lotId ?? null,
          lotName: section?.lot?.name ?? null,
          unitPrice: section?.lot?.unitPrice ?? 0,
          technicalCode: seat.technicalCode,
          displayLabel: seat.displayLabel,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          status:
            seat.status === 'AVAILABLE'
              ? 'AVAILABLE'
              : seat.status === 'SOLD'
                ? 'SOLD'
                : seat.status === 'HELD'
                  ? 'HELD'
                  : seat.status === 'BLOCKED'
                    ? 'BLOCKED'
                    : 'UNAVAILABLE',
          accessible: seat.accessible,
          publicVisible: seat.publicVisible,
          x: seat.x,
          y: seat.y,
          size: seat.size,
          rotation: seat.rotation,
        };
      }),
    counts: {
      seats: map.seats.filter((seat) => seat.publicVisible).length,
      availableSeats: map.seats.filter((seat) => seat.publicVisible && seat.status === 'AVAILABLE').length,
      soldSeats: map.seats.filter((seat) => seat.publicVisible && seat.status === 'SOLD').length,
      heldSeats: map.seats.filter((seat) => seat.publicVisible && seat.status === 'HELD').length,
    },
  };
}
