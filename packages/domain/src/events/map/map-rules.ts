export type EventTicketMode = 'NONE' | 'SIMPLE' | 'NUMBERED_SEATS';
export type EventMapStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type EventSeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'COMPLIMENTARY' | 'UNAVAILABLE';

export type EventMapTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

const MAP_STATUS_TRANSITIONS: Record<EventMapStatus, EventMapStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

export type PublishableMapInput = {
  ticketMode: EventTicketMode;
  levelsCount: number;
  sections: Array<{ id: string; name: string; lotId?: string | null }>;
  seats: Array<{ id: string; sectionId?: string | null; status: EventSeatStatus; publicVisible?: boolean }>;
};

export type PublishValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validateEventMapStatusTransition(
  current: EventMapStatus,
  next: EventMapStatus,
): EventMapTransitionResult {
  if (current === next) return { ok: true };
  if (MAP_STATUS_TRANSITIONS[current]?.includes(next)) return { ok: true };
  return { ok: false, reason: `Transição de ${current} para ${next} não permitida.` };
}

export function validatePublishableEventMap(input: PublishableMapInput): PublishValidationResult {
  const errors: string[] = [];

  if (input.ticketMode !== 'NUMBERED_SEATS') {
    errors.push('O evento precisa usar assentos numerados para publicar um mapa.');
  }

  if (input.levelsCount <= 0) {
    errors.push('Crie pelo menos uma prancheta ou nível.');
  }

  if (input.sections.length <= 0) {
    errors.push('Crie pelo menos um setor.');
  }

  const sectionsWithoutLot = input.sections.filter((section) => !section.lotId);
  if (sectionsWithoutLot.length > 0) {
    errors.push('Todos os setores vendáveis precisam estar vinculados a um lote.');
  }

  if (input.seats.length <= 0) {
    errors.push('Crie pelo menos um assento.');
  }

  const seatsWithoutSection = input.seats.filter((seat) => !seat.sectionId);
  if (seatsWithoutSection.length > 0) {
    errors.push('Todos os assentos precisam pertencer a um setor.');
  }

  const availableSeats = input.seats.filter(
    (seat) => seat.status === 'AVAILABLE' && seat.publicVisible !== false,
  );
  if (availableSeats.length <= 0) {
    errors.push('O mapa precisa ter assentos disponíveis para venda.');
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
