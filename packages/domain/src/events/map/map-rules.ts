export type EventTicketMode = 'NONE' | 'SIMPLE' | 'NUMBERED_SEATS';
export type EventMapStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type EventSeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'COMPLIMENTARY' | 'UNAVAILABLE';
export type EventMapPublicSeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
export type EventMapDeletionAction = 'DELETE' | 'ARCHIVE' | 'DEMOTE_TO_DRAFT' | 'BLOCK';

export const MAX_EVENT_MAPS_PER_EVENT = 5;

export type EventMapTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

const MAP_STATUS_TRANSITIONS: Record<EventMapStatus, EventMapStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['PUBLISHED', 'ARCHIVED', 'DRAFT'],
  ARCHIVED: [],
};

const MAP_PANEL_SORT_ORDER: Record<EventMapStatus, number> = {
  PUBLISHED: 0,
  DRAFT: 1,
  ARCHIVED: 2,
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
  | { action: 'DEMOTE_TO_DRAFT'; reason: string }
  | { action: 'BLOCK'; reason: string };

export type PublishedMapReplacementAction = 'ARCHIVE' | 'DEMOTE_TO_DRAFT';

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

export function canCreateEventMap(mapCount: number) {
  return mapCount < MAX_EVENT_MAPS_PER_EVENT;
}

export function isOperationalEventMapStatus(status: EventMapStatus) {
  return status !== 'ARCHIVED';
}

export function eventMapDeletionUserMessage(action: EventMapDeletionDecision['action']) {
  if (action === 'ARCHIVE') {
    return 'O mapa será removido da listagem. Pedidos, tickets, versões publicadas e trilha de auditoria permanecem no sistema.';
  }
  if (action === 'DEMOTE_TO_DRAFT') {
    return 'O mapa ativo voltará para template e a venda pública ficará indisponível até publicar outro mapa.';
  }
  return 'O template será excluído permanentemente porque nunca foi publicado nem gerou pedidos.';
}

export function resolvePublishedMapReplacement(ordersCount: number): PublishedMapReplacementAction {
  return ordersCount > 0 ? 'ARCHIVE' : 'DEMOTE_TO_DRAFT';
}

export function sortEventMapsForDisplay<T extends { status: EventMapStatus; updatedAt: string }>(maps: T[]) {
  return [...maps].sort((left, right) => {
    const statusDiff = MAP_PANEL_SORT_ORDER[left.status] - MAP_PANEL_SORT_ORDER[right.status];
    if (statusDiff !== 0) return statusDiff;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function resolveActivePublishedEventMap<T extends { id: string; status: EventMapStatus; updatedAt: string }>(
  maps: T[],
): T | null {
  const published = maps.filter((map) => map.status === 'PUBLISHED');
  if (published.length === 0) return null;
  return sortEventMapsForDisplay(published)[0] ?? null;
}

export function countTicketLotCapacitiesFromMap(input: {
  sections: Array<{ id: string; lotId?: string | null }>;
  seats: Array<{ sectionId: string; publicVisible?: boolean }>;
}) {
  const lotBySectionId = new Map(input.sections.map((section) => [section.id, section.lotId?.trim() || null]));
  const capacityByLotId = new Map<string, number>();

  for (const seat of input.seats) {
    if (seat.publicVisible === false) continue;
    const lotId = lotBySectionId.get(seat.sectionId);
    if (!lotId) continue;
    capacityByLotId.set(lotId, (capacityByLotId.get(lotId) ?? 0) + 1);
  }

  return capacityByLotId;
}

export function decideEventMapDeletion(input: {
  status: EventMapStatus;
  versionsCount: number;
  ordersCount: number;
}): EventMapDeletionDecision {
  if (input.status === 'ARCHIVED') {
    return { action: 'BLOCK', reason: 'Este mapa já foi removido da operação.' };
  }

  if (input.ordersCount > 0 || input.versionsCount > 0) {
    return {
      action: 'ARCHIVE',
      reason: eventMapDeletionUserMessage('ARCHIVE'),
    };
  }

  if (input.status === 'PUBLISHED') {
    return {
      action: 'DEMOTE_TO_DRAFT',
      reason: eventMapDeletionUserMessage('DEMOTE_TO_DRAFT'),
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
  if (input.maxSeats != null && uniqueSeatIds.length > input.maxSeats) {
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

export const STAFF_SEAT_RESERVATION_TTL_MINUTES = 15;

export type StaffSeatRecord = {
  id: string;
  status: EventMapPublicSeatStatus;
  lotId?: string | null;
  unitPrice?: number;
};

export function validateStaffSeatSelection(input: {
  requestedSeatIds: string[];
  seats: StaffSeatRecord[];
  ownHeldSeatIds?: string[];
  maxSeats?: number;
}): PublicSeatSelectionResult {
  const uniqueSeatIds = [...new Set(input.requestedSeatIds.map((seatId) => seatId.trim()).filter(Boolean))];
  if (uniqueSeatIds.length === 0) return { ok: false, reason: 'Selecione pelo menos um assento.' };

  const maxSeats = input.maxSeats;
  if (maxSeats != null && uniqueSeatIds.length > maxSeats) {
    return { ok: false, reason: `Selecione no máximo ${maxSeats} assentos por venda.` };
  }

  const ownHeld = new Set(input.ownHeldSeatIds ?? []);
  const seatsById = new Map(input.seats.map((seat) => [seat.id, seat]));
  const missing = uniqueSeatIds.filter((seatId) => !seatsById.has(seatId));
  if (missing.length > 0) return { ok: false, reason: 'Um ou mais assentos não existem neste mapa.' };

  const unavailable = uniqueSeatIds.filter((seatId) => {
    const seat = seatsById.get(seatId);
    if (!seat) return true;
    if (seat.status === 'AVAILABLE') return false;
    if (seat.status === 'HELD' && ownHeld.has(seatId)) return false;
    return true;
  });
  if (unavailable.length > 0) {
    return { ok: false, reason: 'Um ou mais assentos não estão disponíveis para venda.' };
  }

  return { ok: true, seatIds: uniqueSeatIds };
}

export function groupStaffSeatsByLot<T extends { lotId?: string | null }>(seats: T[]) {
  const groups = new Map<string, T[]>();
  for (const seat of seats) {
    const lotId = seat.lotId?.trim();
    if (!lotId) continue;
    const group = groups.get(lotId) ?? [];
    group.push(seat);
    groups.set(lotId, group);
  }
  return groups;
}

export function isPublicEventMapVisible(input: {
  status: EventMapStatus;
  publicEnabled: boolean;
  publishedVersionId?: string | null;
}) {
  return input.status === 'PUBLISHED' && input.publicEnabled && Boolean(input.publishedVersionId);
}
