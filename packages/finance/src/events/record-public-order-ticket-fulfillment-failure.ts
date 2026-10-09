import { prisma } from '@alusa/database';
import { normalizeTicketFulfillmentError } from '@alusa/lib/events/map/event-map-order-operations';

function resolveFailureStatus(reason: string) {
  const normalized = reason.toUpperCase();
  return normalized.includes('RESERVA_EXPIRADA')
    || normalized.includes('ASSENTOS_INDISPONIVEIS')
    || normalized.includes('ASSENTOS_REVENDIDOS')
    || normalized.includes('RESERVA_INVALIDA')
    || normalized.includes('VALOR_PAGAMENTO_DIVERGENTE')
    || normalized.includes('PEDIDO_NAO_ENCONTRADO')
    ? 'REQUIRES_RECONCILIATION' as const
    : 'FAILED' as const;
}

/** Persists an idempotent, tenant-scoped ticket fulfillment failure for a paid order. */
export async function recordPublicOrderTicketFulfillmentFailure(params: {
  contaId: string;
  orderId: string;
  reason?: string | null;
}) {
  const reason = normalizeTicketFulfillmentError(params.reason);
  const status = resolveFailureStatus(reason);
  const updated = await prisma.eventMapOrder.updateMany({
    where: {
      id: params.orderId,
      contaId: params.contaId,
      status: 'CONFIRMED',
      ticketFulfillmentStatus: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      ticketFulfillmentStatus: status,
      ticketFulfillmentAttempts: { increment: 1 },
      ticketFulfillmentLastAttemptAt: new Date(),
      ticketFulfillmentLastError: reason,
    },
  });

  return { updated: updated.count > 0, status };
}
