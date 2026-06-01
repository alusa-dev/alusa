export const SCHOOL_EVENT_STATUSES = [
  'DRAFT',
  'PLANNING',
  'ACTIVE',
  'FINISHED',
  'CANCELLED',
  'ARCHIVED',
] as const;

export type SchoolEventStatus = (typeof SCHOOL_EVENT_STATUSES)[number];

export const SCHOOL_EVENT_TYPES = [
  'PRESENTATION',
  'PARTY',
  'GRADUATION',
  'TRIP',
  'WORKSHOP',
  'MEETING',
  'CHAMPIONSHIP',
  'CULTURAL_SHOW',
  'OTHER',
] as const;

export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export const EVENT_TICKET_TYPES = [
  'FULL',
  'HALF',
  'PROMOTIONAL',
  'COMPLIMENTARY',
  'STUDENT',
  'GUARDIAN',
  'GUEST',
  'OTHER',
] as const;

export type EventTicketType = (typeof EVENT_TICKET_TYPES)[number];

export const EVENT_TICKET_MODES = ['NONE', 'SIMPLE', 'NUMBERED_SEATS'] as const;
export type EventTicketMode = (typeof EVENT_TICKET_MODES)[number];

export const EVENT_TICKET_LOT_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SOLD_OUT',
  'CLOSED',
  'CANCELLED',
  'ARCHIVED',
] as const;

export type EventTicketLotStatus = (typeof EVENT_TICKET_LOT_STATUSES)[number];

export const EVENT_MAP_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type EventMapStatus = (typeof EVENT_MAP_STATUSES)[number];

export const EVENT_MAP_OBJECT_TYPES = [
  'BOARD',
  'SECTION',
  'ROW',
  'SEAT',
  'STAGE',
  'TABLE',
  'TEXT',
  'BLOCKED_AREA',
  'CORRIDOR',
  'BOOTH',
  'GENERAL_AREA',
] as const;
export type EventMapObjectType = (typeof EVENT_MAP_OBJECT_TYPES)[number];

export const EVENT_SEAT_STATUSES = [
  'AVAILABLE',
  'HELD',
  'SOLD',
  'BLOCKED',
  'COMPLIMENTARY',
  'UNAVAILABLE',
] as const;
export type EventSeatStatus = (typeof EVENT_SEAT_STATUSES)[number];

export const EVENT_TICKET_SALE_STATUSES = [
  'PENDING',
  'PAID',
  'CANCELLED',
  'REFUNDED',
  'COMPLIMENTARY',
] as const;

export type EventTicketSaleStatus = (typeof EVENT_TICKET_SALE_STATUSES)[number];

export const EVENT_PAYMENT_METHODS = [
  'CASH',
  'MANUAL_PIX',
  'EXTERNAL_CARD',
  'TRANSFER',
  'COMPLIMENTARY',
  'OTHER',
] as const;

export type EventPaymentMethod = (typeof EVENT_PAYMENT_METHODS)[number];

export const EVENT_COSTUME_CATEGORIES = [
  'CLOTHING',
  'ACCESSORY',
  'SHOES',
  'PROP',
  'COMPLETE_KIT',
  'OTHER',
] as const;

export type EventCostumeCategory = (typeof EVENT_COSTUME_CATEGORIES)[number];

export const EVENT_COSTUME_ASSIGNMENT_STATUSES = [
  'PENDING',
  'ORDERED',
  'RECEIVED',
  'DELIVERED',
  'RETURNED',
  'DAMAGED',
  'LOST',
  'CANCELLED',
] as const;

export type EventCostumeAssignmentStatus = (typeof EVENT_COSTUME_ASSIGNMENT_STATUSES)[number];

export const EVENT_FINANCIAL_ENTRY_TYPES = ['COST', 'REVENUE'] as const;
export type EventFinancialEntryType = (typeof EVENT_FINANCIAL_ENTRY_TYPES)[number];

export const EVENT_FINANCIAL_ENTRY_STATUSES = [
  'EXPECTED',
  'PENDING',
  'PAID',
  'RECEIVED',
  'CANCELLED',
  'REFUNDED',
] as const;

export type EventFinancialEntryStatus = (typeof EVENT_FINANCIAL_ENTRY_STATUSES)[number];

export const EVENT_FINANCIAL_ORIGIN_TYPES = [
  'MANUAL',
  'TICKET_SALE',
  'COSTUME',
  'COSTUME_ASSIGNMENT',
] as const;

export type EventFinancialOriginType = (typeof EVENT_FINANCIAL_ORIGIN_TYPES)[number];

export const EVENT_REPORT_TYPES = ['GENERAL', 'EVENT', 'COMPARATIVE'] as const;
export type EventReportType = (typeof EVENT_REPORT_TYPES)[number];

export const EVENT_STATUS_LABELS: Record<SchoolEventStatus, string> = {
  DRAFT: 'Rascunho',
  PLANNING: 'Planejamento',
  ACTIVE: 'Ativo',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

export const EVENT_TYPE_LABELS: Record<SchoolEventType, string> = {
  PRESENTATION: 'Apresentação',
  PARTY: 'Festa',
  GRADUATION: 'Formatura',
  TRIP: 'Passeio',
  WORKSHOP: 'Workshop',
  MEETING: 'Reunião',
  CHAMPIONSHIP: 'Campeonato',
  CULTURAL_SHOW: 'Mostra cultural',
  OTHER: 'Outro',
};

export const EVENT_TICKET_TYPE_LABELS: Record<EventTicketType, string> = {
  FULL: 'Inteira',
  HALF: 'Meia',
  PROMOTIONAL: 'Promocional',
  COMPLIMENTARY: 'Cortesia',
  STUDENT: 'Aluno',
  GUARDIAN: 'Responsável',
  GUEST: 'Convidado',
  OTHER: 'Outro',
};

export const EVENT_TICKET_MODE_LABELS: Record<EventTicketMode, string> = {
  NONE: 'Sem ingressos',
  SIMPLE: 'Ingressos simples',
  NUMBERED_SEATS: 'Assentos numerados',
};

export const EVENT_TICKET_LOT_STATUS_LABELS: Record<EventTicketLotStatus, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativo',
  SOLD_OUT: 'Esgotado',
  CLOSED: 'Encerrado',
  CANCELLED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

export const EVENT_MAP_STATUS_LABELS: Record<EventMapStatus, string> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
};

export const EVENT_MAP_OBJECT_TYPE_LABELS: Record<EventMapObjectType, string> = {
  BOARD: 'Prancheta',
  SECTION: 'Setor',
  ROW: 'Fileira',
  SEAT: 'Cadeira',
  STAGE: 'Palco',
  TABLE: 'Mesa',
  TEXT: 'Texto',
  BLOCKED_AREA: 'Área bloqueada',
  CORRIDOR: 'Corredor',
  BOOTH: 'Camarote',
  GENERAL_AREA: 'Área geral',
};

export const EVENT_SEAT_STATUS_LABELS: Record<EventSeatStatus, string> = {
  AVAILABLE: 'Disponível',
  HELD: 'Reservado',
  SOLD: 'Vendido',
  BLOCKED: 'Bloqueado',
  COMPLIMENTARY: 'Cortesia',
  UNAVAILABLE: 'Indisponível',
};

export const EVENT_TICKET_SALE_STATUS_LABELS: Record<EventTicketSaleStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Estornado',
  COMPLIMENTARY: 'Cortesia',
};

export const EVENT_PAYMENT_METHOD_LABELS: Record<EventPaymentMethod, string> = {
  CASH: 'Dinheiro',
  MANUAL_PIX: 'Pix',
  EXTERNAL_CARD: 'Cartão Externo',
  TRANSFER: 'Transferência',
  COMPLIMENTARY: 'Cortesia',
  OTHER: 'Outro',
};

export const EVENT_COSTUME_CATEGORY_LABELS: Record<EventCostumeCategory, string> = {
  CLOTHING: 'Roupa',
  ACCESSORY: 'Acessório',
  SHOES: 'Calçado',
  PROP: 'Adereço',
  COMPLETE_KIT: 'Kit completo',
  OTHER: 'Outro',
};

export const EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS: Record<EventCostumeAssignmentStatus, string> = {
  PENDING: 'Pendente',
  ORDERED: 'Encomendado',
  RECEIVED: 'Recebido',
  DELIVERED: 'Entregue',
  RETURNED: 'Devolvido',
  DAMAGED: 'Danificado',
  LOST: 'Perdido',
  CANCELLED: 'Cancelado',
};

export const EVENT_FINANCIAL_STATUS_LABELS: Record<EventFinancialEntryStatus, string> = {
  EXPECTED: 'Previsto',
  PENDING: 'Pendente',
  PAID: 'Pago',
  RECEIVED: 'Recebido',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Estornado',
};

export const EVENT_COST_CATEGORIES = [
  'Figurino',
  'Decoração',
  'Espaço',
  'Som e iluminação',
  'Alimentação',
  'Transporte',
  'Equipe',
  'Material',
  'Marketing',
  'Taxas',
  'Fornecedor',
  'Outros',
] as const;

export const EVENT_REVENUE_CATEGORIES = [
  'Venda de ingresso',
  'Figurino',
  'Patrocínio',
  'Venda interna',
  'Inscrição',
  'Taxa extra',
  'Outros',
] as const;
