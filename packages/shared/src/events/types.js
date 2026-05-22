export const SCHOOL_EVENT_STATUSES = [
    'DRAFT',
    'PLANNING',
    'ACTIVE',
    'FINISHED',
    'CANCELLED',
    'ARCHIVED',
];
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
];
export const EVENT_TICKET_TYPES = [
    'FULL',
    'HALF',
    'PROMOTIONAL',
    'COMPLIMENTARY',
    'STUDENT',
    'GUARDIAN',
    'GUEST',
    'OTHER',
];
export const EVENT_TICKET_MODES = ['NONE', 'SIMPLE', 'NUMBERED_SEATS'];
export const EVENT_TICKET_LOT_STATUSES = [
    'DRAFT',
    'ACTIVE',
    'SOLD_OUT',
    'CLOSED',
    'CANCELLED',
    'ARCHIVED',
];
export const EVENT_MAP_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
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
];
export const EVENT_SEAT_STATUSES = [
    'AVAILABLE',
    'HELD',
    'SOLD',
    'BLOCKED',
    'COMPLIMENTARY',
    'UNAVAILABLE',
];
export const EVENT_TICKET_SALE_STATUSES = [
    'PENDING',
    'PAID',
    'CANCELLED',
    'REFUNDED',
    'COMPLIMENTARY',
];
export const EVENT_PAYMENT_METHODS = [
    'CASH',
    'MANUAL_PIX',
    'EXTERNAL_CARD',
    'TRANSFER',
    'COMPLIMENTARY',
    'OTHER',
];
export const EVENT_COSTUME_CATEGORIES = [
    'CLOTHING',
    'ACCESSORY',
    'SHOES',
    'PROP',
    'COMPLETE_KIT',
    'OTHER',
];
export const EVENT_COSTUME_ASSIGNMENT_STATUSES = [
    'PENDING',
    'ORDERED',
    'RECEIVED',
    'DELIVERED',
    'RETURNED',
    'DAMAGED',
    'LOST',
    'CANCELLED',
];
export const EVENT_FINANCIAL_ENTRY_TYPES = ['COST', 'REVENUE'];
export const EVENT_FINANCIAL_ENTRY_STATUSES = [
    'EXPECTED',
    'PENDING',
    'PAID',
    'RECEIVED',
    'CANCELLED',
    'REFUNDED',
];
export const EVENT_FINANCIAL_ORIGIN_TYPES = [
    'MANUAL',
    'TICKET_SALE',
    'COSTUME',
    'COSTUME_ASSIGNMENT',
];
export const EVENT_REPORT_TYPES = ['GENERAL', 'EVENT', 'COMPARATIVE'];
export const EVENT_STATUS_LABELS = {
    DRAFT: 'Rascunho',
    PLANNING: 'Planejamento',
    ACTIVE: 'Ativo',
    FINISHED: 'Finalizado',
    CANCELLED: 'Cancelado',
    ARCHIVED: 'Arquivado',
};
export const EVENT_TYPE_LABELS = {
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
export const EVENT_TICKET_TYPE_LABELS = {
    FULL: 'Inteira',
    HALF: 'Meia',
    PROMOTIONAL: 'Promocional',
    COMPLIMENTARY: 'Cortesia',
    STUDENT: 'Aluno',
    GUARDIAN: 'Responsável',
    GUEST: 'Convidado',
    OTHER: 'Outro',
};
export const EVENT_TICKET_MODE_LABELS = {
    NONE: 'Sem ingressos',
    SIMPLE: 'Ingressos simples',
    NUMBERED_SEATS: 'Assentos numerados',
};
export const EVENT_TICKET_LOT_STATUS_LABELS = {
    DRAFT: 'Rascunho',
    ACTIVE: 'Ativo',
    SOLD_OUT: 'Esgotado',
    CLOSED: 'Encerrado',
    CANCELLED: 'Cancelado',
    ARCHIVED: 'Arquivado',
};
export const EVENT_MAP_STATUS_LABELS = {
    DRAFT: 'Rascunho',
    PUBLISHED: 'Publicado',
    ARCHIVED: 'Arquivado',
};
export const EVENT_MAP_OBJECT_TYPE_LABELS = {
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
export const EVENT_SEAT_STATUS_LABELS = {
    AVAILABLE: 'Disponível',
    HELD: 'Reservado',
    SOLD: 'Vendido',
    BLOCKED: 'Bloqueado',
    COMPLIMENTARY: 'Cortesia',
    UNAVAILABLE: 'Indisponível',
};
export const EVENT_TICKET_SALE_STATUS_LABELS = {
    PENDING: 'Pendente',
    PAID: 'Pago',
    CANCELLED: 'Cancelado',
    REFUNDED: 'Estornado',
    COMPLIMENTARY: 'Cortesia',
};
export const EVENT_PAYMENT_METHOD_LABELS = {
    CASH: 'Dinheiro',
    MANUAL_PIX: 'Pix manual',
    EXTERNAL_CARD: 'Cartão externo',
    TRANSFER: 'Transferência',
    COMPLIMENTARY: 'Cortesia',
    OTHER: 'Outro',
};
export const EVENT_COSTUME_CATEGORY_LABELS = {
    CLOTHING: 'Roupa',
    ACCESSORY: 'Acessório',
    SHOES: 'Calçado',
    PROP: 'Adereço',
    COMPLETE_KIT: 'Kit completo',
    OTHER: 'Outro',
};
export const EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS = {
    PENDING: 'Pendente',
    ORDERED: 'Encomendado',
    RECEIVED: 'Recebido',
    DELIVERED: 'Entregue',
    RETURNED: 'Devolvido',
    DAMAGED: 'Danificado',
    LOST: 'Perdido',
    CANCELLED: 'Cancelado',
};
export const EVENT_FINANCIAL_STATUS_LABELS = {
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
];
export const EVENT_REVENUE_CATEGORIES = [
    'Venda de ingresso',
    'Figurino',
    'Patrocínio',
    'Venda interna',
    'Inscrição',
    'Taxa extra',
    'Outros',
];
