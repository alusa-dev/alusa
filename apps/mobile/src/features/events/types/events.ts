export type EventStatus = 'DRAFT' | 'PLANNING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED' | 'ARCHIVED' | string;
export type EventType = 'PRESENTATION' | 'PARTY' | 'GRADUATION' | 'TRIP' | 'WORKSHOP' | 'MEETING' | 'CHAMPIONSHIP' | 'CULTURAL_SHOW' | 'OTHER' | string;
export type EventFinancialEntryType = 'COST' | 'REVENUE';
export type EventFinancialEntryStatus = 'EXPECTED' | 'PENDING' | 'PAID' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | string;
export type EventPaymentMethod = 'CASH' | 'MANUAL_PIX' | 'EXTERNAL_CARD' | 'TRANSFER' | 'COMPLIMENTARY' | 'OTHER' | string;

export type MobileEvent = {
  id: string;
  name: string;
  description: string | null;
  type: EventType;
  status: EventStatus;
  startsAt: string;
  endsAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  estimatedCapacity: number | null;
  hasTickets: boolean;
  ticketMode: 'NONE' | 'SIMPLE' | 'NUMBERED_SEATS' | string;
  hasCostumes: boolean;
  hasFinancialControl: boolean;
  notes: string | null;
  capabilities: {
    canViewFinancial: boolean;
    canCreateFinancial: boolean;
    canManageFinancial: boolean;
    canManageCostumes: boolean;
    canFinish: boolean;
    canReactivate: boolean;
  };
  metrics: {
    receitaPrevista: number | null;
    receitaRealizada: number | null;
    custoRealizado: number | null;
    resultadoRealizado: number | null;
    ingressosVendidos: number;
    ingressosDisponiveis: number;
    taxaOcupacao: number | null;
    figurinosPendentes: number;
    figurinosEntregues: number;
    figurinosDevolvidos: number;
  };
  counts: {
    lots: number;
    ticketSales: number;
    costumes: number;
    costumeAssignments: number;
    financialEntries: number;
  };
};

export type EventListResponse = {
  events: MobileEvent[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

export type EventDetailResponse = {
  event: MobileEvent;
};

export type MobileEventFinancialEntry = {
  id: string;
  eventId: string;
  type: EventFinancialEntryType;
  category: string;
  description: string;
  supplier: string | null;
  originType: 'MANUAL' | 'TICKET_SALE' | 'COSTUME' | 'COSTUME_ASSIGNMENT' | string;
  originId: string | null;
  expectedAmount: number;
  actualAmount: number | null;
  refundedAmount: number;
  netAmount: number | null;
  dueDate: string | null;
  realizedAt: string | null;
  status: EventFinancialEntryStatus;
  paymentMethod: EventPaymentMethod | null;
  notes: string | null;
};

export type EventFinancialEntriesResponse = {
  entries: MobileEventFinancialEntry[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

export type EventFinancialEntryResponse = {
  entry: MobileEventFinancialEntry;
};

export type MobileEventParticipantFinancialStatus = 'ISENTO' | 'PENDENTE' | 'PARCIAL' | 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'ESTORNADO' | 'CANCELADO' | string;

export type MobileEventParticipant = {
  id: string;
  eventId: string;
  alunoId: string | null;
  displayName: string;
  aluno: { id: string; nome: string; foto: string | null } | null;
  turma: { id: string; nome: string } | null;
  registrationFeeCharged: number;
  feePaidAmount: number;
  percentPaid: number;
  financialStatus: MobileEventParticipantFinancialStatus;
  feePaymentMethod: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

export type EventParticipantsResponse = {
  participants: MobileEventParticipant[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

export type MobileCostume = {
  id: string;
  name: string;
  category: string;
  size: string | null;
  chargedValue: number | null;
  quantity: number;
  assignmentsCount: number;
};

export type MobileCostumeResourcesResponse = {
  costumes: MobileCostume[];
  resources: {
    alunos: Array<{ id: string; nome: string }>;
    turmas: Array<{ id: string; nome: string }>;
  };
};

export type MobileTicketEvent = {
  id: string;
  name: string;
  status: EventStatus;
  startsAt: string;
};

export type VerifiedTicket = {
  ticketId: string;
  ticketCode: string;
  status: 'VALID' | 'USED' | 'CANCELLED' | 'REISSUED' | string;
  usedAt: string | null;
  order: { id: string; buyerName: string; buyerEmail: string; status: string } | null;
  sale: { id: string; buyerName: string; status: string } | null;
  seat: { sectionName: string; seatLabel: string; technicalCode: string } | null;
};

export type TicketVerificationResponse = {
  event: MobileTicketEvent;
  ticket: VerifiedTicket;
};

export type TicketCheckInResponse = {
  ok: true;
  alreadyUsed: boolean;
  event: MobileTicketEvent;
  ticket: VerifiedTicket;
};
