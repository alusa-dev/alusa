import type {
  PaidReceiptAluno,
  PaidReceiptItem,
} from '@/features/financeiro/pagamentos/paid-receipts-pdf';

type EventTicketSaleReceiptCobranca = {
  id: string;
  status?: string;
  descricao?: string | null;
  valor: number;
  vencimento: string;
  dataPagamento?: string | null;
  formaPagamento: string;
  asaasPaymentId?: string | null;
  matricula: {
    aluno: {
      id: string;
      nome: string;
      cpf?: string | null;
      email?: string | null;
      telefone?: string | null;
    };
  };
  eventDetails?: {
    eventName: string;
    buyerName: string;
    seats: Array<{ seatLabel: string; sectionName: string }>;
  } | null;
};

const MANUAL_EVENT_TICKET_RECEIPT_STATUSES = new Set(['PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL']);

function resolveReceiptPaymentStatus(status?: string | null) {
  switch (status) {
    case 'ESTORNADO':
      return 'REFUNDED';
    case 'ESTORNADO_PARCIAL':
      return 'PARTIALLY_REFUNDED';
    case 'PAGO':
    default:
      return 'PAID';
  }
}

function parseEventTicketSaleId(operationalId: string) {
  return operationalId.startsWith('event-ticket-sale:')
    ? operationalId.slice('event-ticket-sale:'.length)
    : operationalId;
}

function buildSeatDescription(eventDetails: EventTicketSaleReceiptCobranca['eventDetails']) {
  if (!eventDetails) return null;

  const seatSummary = eventDetails.seats.length
    ? eventDetails.seats.map((seat) => `${seat.sectionName} ${seat.seatLabel}`).join(', ')
    : null;

  if (seatSummary) {
    return `Ingressos - ${eventDetails.eventName} (${seatSummary})`;
  }

  return `Ingressos - ${eventDetails.eventName}`;
}

export function isManualEventTicketSaleReceipt(cobranca: {
  id: string;
  origin?: string | null;
  asaasPaymentId?: string | null;
}) {
  return (
    cobranca.origin === 'EVENT' &&
    cobranca.id.startsWith('event-ticket-sale:') &&
    !cobranca.asaasPaymentId
  );
}

export function canViewManualEventTicketSaleReceipt(cobranca: {
  id: string;
  origin?: string | null;
  status?: string;
  asaasPaymentId?: string | null;
}) {
  return (
    isManualEventTicketSaleReceipt(cobranca) &&
    MANUAL_EVENT_TICKET_RECEIPT_STATUSES.has(cobranca.status ?? '')
  );
}

export function buildEventTicketSaleReceiptInput(
  cobranca: EventTicketSaleReceiptCobranca,
): { aluno: PaidReceiptAluno; item: PaidReceiptItem } {
  const saleId = parseEventTicketSaleId(cobranca.id);
  const buyerName = cobranca.eventDetails?.buyerName ?? cobranca.matricula.aluno.nome;
  const paidAt = cobranca.dataPagamento ?? cobranca.vencimento ?? new Date().toISOString();
  const description = cobranca.descricao ?? buildSeatDescription(cobranca.eventDetails) ?? 'Venda de ingresso';
  const paymentStatus = resolveReceiptPaymentStatus(cobranca.status);

  return {
    aluno: {
      id: cobranca.matricula.aluno.id,
      nome: buyerName,
      cpf: cobranca.matricula.aluno.cpf ?? null,
    },
    item: {
      id: cobranca.id,
      sourceKind: 'event_ticket_sale',
      sourceId: saleId,
      chargeType: 'EVENT_TICKET',
      origin: 'EVENT',
      tipo: 'EVENT_TICKET',
      category: 'EVENTOS',
      description,
      payerName: buyerName,
      valor: cobranca.valor,
      vencimento: cobranca.vencimento ?? null,
      billingType: cobranca.formaPagamento ?? null,
      asaasPaymentId: null,
      matriculaId: null,
      createdAt: paidAt,
      pagamento: {
        id: saleId,
        status: paymentStatus,
        valorPago: cobranca.valor,
        dataPagamento: paidAt,
        formaPagamento: cobranca.formaPagamento ?? 'MANUAL',
        comprovante: null,
        asaasPaymentId: null,
        createdAt: paidAt,
      },
    },
  };
}
