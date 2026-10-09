import { publicOrderStatusLabel } from '../public/public-order-utils';

export type PublicOrderStatusSummary = {
  status: string;
  paymentStatus: string | null;
  asaasPaymentId?: string | null;
  ticketFulfillmentStatus: 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
  ticketCount: number;
  seatCount: number;
};

export function isPublicOrderPaymentBlocked(paymentStatus: string | null | undefined) {
  return [
    'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PAYMENT_REFUND_IN_PROGRESS', 'REFUNDED', 'PAYMENT_REFUNDED',
    'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'IN_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DISPUTE_LOST', 'CHARGEBACK',
    'REQUESTED', 'DONE', 'CHARGEBACK_UNKNOWN',
  ].includes((paymentStatus ?? '').trim().toUpperCase());
}

export function publicOrderAdminStatusLabel(order: PublicOrderStatusSummary) {
  const chargebackStatus = (order.paymentStatus ?? '').trim().toUpperCase();
  if (chargebackStatus === 'DISPUTE_LOST') return 'Contestação perdida';
  if (chargebackStatus === 'REVERSED') return 'Contestação revertida';
  if (chargebackStatus === 'DONE') return 'Contestação encerrada';
  if (chargebackStatus === 'CHARGEBACK_UNKNOWN') return 'Em disputa';
  if (['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'IN_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DISPUTE_LOST', 'CHARGEBACK']
    .includes(chargebackStatus) || ['REQUESTED', 'IN_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'].includes(chargebackStatus)) return 'Em disputa';
  if (['REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'PAYMENT_REFUND_IN_PROGRESS'].includes(order.paymentStatus ?? '')) return 'Estornando';
  if (order.paymentStatus === 'REFUND_DENIED') return 'Estorno recusado';
  if (order.status === 'PARTIALLY_REFUNDED') return 'Estorno parcial';
  if (order.status === 'REFUNDED') return 'Estornado';
  if (order.status === 'CONFIRMED') {
    if (order.ticketFulfillmentStatus === 'PENDING') return 'Emitindo';
    if (order.ticketFulfillmentStatus !== 'ISSUED' || order.ticketCount < order.seatCount) return 'Falha na emissão';
    return 'Concluído';
  }
  if (order.status === 'PAYMENT_PENDING') {
    if (order.paymentStatus === 'OVERDUE') return 'Vencido';
    if (order.paymentStatus !== 'PENDING' || !order.asaasPaymentId) return 'Verificando';
    return 'Aguardando';
  }
  if (order.status === 'EXPIRED') return 'Expirado';
  if (order.status === 'CANCELLED') return 'Cancelado';
  return publicOrderStatusLabel(order.status);
}

export function publicOrderAdminStatusDescription(order: PublicOrderStatusSummary) {
  if (order.status === 'PAYMENT_PENDING' && order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN') {
    return 'O provedor ainda não confirmou o resultado; os assentos não serão liberados até a verificação.';
  }
  if (order.status === 'PAYMENT_PENDING' && order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS') {
    return 'A criação da cobrança está em andamento; os assentos seguem reservados.';
  }
  const label = publicOrderAdminStatusLabel(order);
  switch (label) {
    case 'Aguardando': return 'Cobrança criada; aguardando confirmação do pagamento.';
    case 'Vencido': return 'O prazo da cobrança venceu. Cancele o pedido para solicitar a exclusão da cobrança e liberar os assentos após confirmação.';
    case 'Verificando': return 'A criação da cobrança está em andamento; os assentos seguem reservados.';
    case 'Emitindo': return 'Pagamento confirmado; ingressos sendo emitidos automaticamente.';
    case 'Concluído': return 'Pagamento confirmado e ingressos emitidos.';
    case 'Expirado': return 'Reserva expirada após confirmação segura de que não há pagamento ativo.';
    case 'Cancelado': return 'Pedido cancelado.';
    case 'Falha na emissão': return 'Pagamento confirmado, mas a emissão precisa de análise operacional.';
    case 'Estornando': return 'Estorno em processamento.';
    case 'Estorno recusado': return 'O estorno não foi concluído e precisa de acompanhamento.';
    case 'Em disputa': return 'A operadora está analisando uma contestação; check-in e ingressos estão bloqueados.';
    case 'Contestação perdida': return 'O provedor confirmou a perda da contestação. Ingressos continuam bloqueados; acione o suporte para revisar o pedido e os assentos.';
    case 'Contestação revertida': return 'O provedor confirmou a reversão da contestação; ingressos podem voltar a ser utilizados.';
    case 'Contestação encerrada': return 'O processo de contestação terminou sem um desfecho interpretável; ingressos continuam bloqueados até reconciliação de suporte.';
    default: return label;
  }
}

export function publicOrderAdminStatusVariant(order: PublicOrderStatusSummary) {
  const label = publicOrderAdminStatusLabel(order);
  if (label === 'Concluído') return 'success' as const;
  if (['Vencido', 'Falha na emissão', 'Estorno parcial', 'Estorno recusado', 'Contestação perdida'].includes(label)) {
    return 'danger' as const;
  }
  if (['Aguardando', 'Verificando', 'Emitindo', 'Estornando', 'Em disputa', 'Contestação encerrada'].includes(label)) return 'warning' as const;
  if (label === 'Estornado') return 'info' as const;
  if (label === 'Contestação revertida') return 'success' as const;
  return 'neutral' as const;
}

export function isSafePaymentUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function publicOrderAdminActions(order: {
  status: string;
  paymentStatus: string | null;
  asaasPaymentId?: string | null;
  invoiceUrl: string | null;
  ticketFulfillmentStatus: PublicOrderStatusSummary['ticketFulfillmentStatus'];
  ticketCount: number;
  seatCount: number;
  ticketsUsed: number;
}, mayRequestRefund: boolean) {
  const paymentBlocked = isPublicOrderPaymentBlocked(order.paymentStatus);
  const completeTicketSet = order.ticketCount > 0 && order.ticketCount === order.seatCount;

  return {
    canCancel: order.status === 'PAYMENT_PENDING' && ['PENDING', 'OVERDUE'].includes(order.paymentStatus ?? '') && Boolean(order.asaasPaymentId),
    canViewRefundDetails: order.status === 'REFUNDED',
    canViewCancellationDetails: order.status === 'CANCELLED',
    invoiceUrl: order.status === 'PAYMENT_PENDING' && isSafePaymentUrl(order.invoiceUrl)
      ? order.invoiceUrl
      : null,
    canDownloadTickets: order.status === 'CONFIRMED' &&
      order.ticketFulfillmentStatus === 'ISSUED' &&
      completeTicketSet &&
      !paymentBlocked,
    canRefund: mayRequestRefund &&
      order.status === 'CONFIRMED' &&
      order.ticketFulfillmentStatus === 'ISSUED' &&
      completeTicketSet &&
      order.ticketsUsed === 0 &&
      !paymentBlocked,
  };
}
