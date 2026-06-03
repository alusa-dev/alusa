export type EventTicketMode = 'NONE' | 'SIMPLE' | 'NUMBERED_SEATS';
export type EventMapStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type EventSeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'COMPLIMENTARY' | 'UNAVAILABLE';
export type EventMapPublicSeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
export type EventMapDeletionAction = 'DELETE' | 'ARCHIVE' | 'BLOCK';

export type EventMapTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

const MAP_STATUS_TRANSITIONS: Record<EventMapStatus, EventMapStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['PUBLISHED', 'ARCHIVED'],
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

export type PublicSeatSelectionResult =
  | { ok: true; seatIds: string[] }
  | { ok: false; reason: string };

export type EventMapDeletionDecision =
  | { action: 'DELETE' }
  | { action: 'ARCHIVE'; reason: string }
  | { action: 'BLOCK'; reason: string };

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

export function canEditEventMapDraft(status: EventMapStatus) {
  return status === 'DRAFT' || status === 'PUBLISHED';
}

export function describeEventMapEditMode(status: EventMapStatus) {
  if (status === 'PUBLISHED') {
    return 'Este mapa está publicado. Alterações salvas ficam no rascunho ativo e só aparecem no link público após publicar novamente.';
  }
  if (status === 'ARCHIVED') return 'Mapa arquivado não aceita edição.';
  return 'Mapa em rascunho aceita edição completa antes da primeira publicação.';
}

export function decideEventMapDeletion(input: {
  status: EventMapStatus;
  versionsCount: number;
  ordersCount: number;
}): EventMapDeletionDecision {
  if (input.status === 'ARCHIVED') {
    return { action: 'BLOCK', reason: 'Mapa arquivado já está fora de operação.' };
  }

  if (input.ordersCount > 0) {
    return {
      action: 'ARCHIVE',
      reason: 'Mapa com pedidos ou tickets emitidos deve ser arquivado para preservar histórico.',
    };
  }

  return { action: 'DELETE' };
}

export function validatePublicSeatSelection(input: {
  requestedSeatIds: string[];
  seats: Array<{ id: string; status: EventMapPublicSeatStatus; publicVisible?: boolean }>;
  maxSeats?: number;
}): PublicSeatSelectionResult {
  const uniqueSeatIds = [...new Set(input.requestedSeatIds.map((seatId) => seatId.trim()).filter(Boolean))];
  if (uniqueSeatIds.length === 0) return { ok: false, reason: 'Selecione pelo menos um assento.' };
  if (input.maxSeats && uniqueSeatIds.length > input.maxSeats) {
    return { ok: false, reason: `Selecione no máximo ${input.maxSeats} assentos por compra.` };
  }

  const seatsById = new Map(input.seats.map((seat) => [seat.id, seat]));
  const missing = uniqueSeatIds.filter((seatId) => !seatsById.has(seatId));
  if (missing.length > 0) return { ok: false, reason: 'Um ou mais assentos não existem neste mapa publicado.' };

  const unavailable = uniqueSeatIds.filter((seatId) => {
    const seat = seatsById.get(seatId);
    return !seat || seat.publicVisible === false || seat.status !== 'AVAILABLE';
  });
  if (unavailable.length > 0) return { ok: false, reason: 'Um ou mais assentos já não estão disponíveis.' };

  return { ok: true, seatIds: uniqueSeatIds };
}

export function isPublicEventMapVisible(input: {
  status: EventMapStatus;
  publicEnabled: boolean;
  publishedVersionId?: string | null;
}) {
  return input.status === 'PUBLISHED' && input.publicEnabled && Boolean(input.publishedVersionId);
}
