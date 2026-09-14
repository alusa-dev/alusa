import type { EventStatus, EventType } from '../types/events';

export function formatEventDate(value: string | null | undefined) {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

export function eventStatusLabel(status: EventStatus) {
  switch (status) {
    case 'DRAFT': return 'Rascunho';
    case 'PLANNING': return 'Planejamento';
    case 'ACTIVE': return 'Ativo';
    case 'FINISHED': return 'Finalizado';
    case 'CANCELLED': return 'Cancelado';
    case 'ARCHIVED': return 'Arquivado';
    default: return status || 'Sem status';
  }
}

export function eventTypeLabel(type: EventType) {
  switch (type) {
    case 'PRESENTATION': return 'Apresentação';
    case 'PARTY': return 'Festa';
    case 'GRADUATION': return 'Formatura';
    case 'TRIP': return 'Passeio';
    case 'WORKSHOP': return 'Workshop';
    case 'MEETING': return 'Reunião';
    case 'CHAMPIONSHIP': return 'Campeonato';
    case 'CULTURAL_SHOW': return 'Mostra cultural';
    default: return 'Evento';
  }
}
