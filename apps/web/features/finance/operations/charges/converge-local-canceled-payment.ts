import { prisma } from '@/lib/prisma';

export type ConvergeLocalCanceledPaymentParams = {
  contaId: string;
  cobrancaId?: string | null;
  chargeId?: string | null;
  asaasPaymentId?: string | null;
  actorId?: string | null;
  reason?: string;
};

/**
 * Keeps local financial records aligned after a provider-side cancellation.
 *
 * The tenant predicate is intentionally repeated on both updates: the
 * operation may target either the legacy Cobranca or the newer Charge model,
 * and neither lookup may widen beyond the authenticated tenant.
 */
export async function convergeLocalCanceledPayment(
  params: ConvergeLocalCanceledPaymentParams,
): Promise<void> {
  const now = new Date();
  const reason = params.reason ?? 'Cancelada no Asaas';

  await prisma.$transaction(async (tx) => {
    if (params.cobrancaId) {
      await tx.cobranca.updateMany({
        where: {
          id: params.cobrancaId,
          contaId: params.contaId,
          status: { notIn: ['CANCELADO', 'PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
        },
        data: {
          status: 'CANCELADO',
          asaasStatus: 'DELETED',
          canceladoEm: now,
          canceladoMotivo: reason,
          canceladoPor: params.actorId ?? 'system',
          liquidacaoStatus: 'NAO_APLICAVEL',
        },
      });
    }

    const chargeWhere = [
      params.chargeId ? { id: params.chargeId } : null,
      params.cobrancaId ? { cobrancaId: params.cobrancaId } : null,
      params.asaasPaymentId ? { asaasPaymentId: params.asaasPaymentId } : null,
    ].filter(
      (where): where is
        | { id: string }
        | { cobrancaId: string }
        | { asaasPaymentId: string } => Boolean(where),
    );

    if (chargeWhere.length > 0) {
      await tx.charge.updateMany({
        where: {
          contaId: params.contaId,
          OR: chargeWhere,
          status: { notIn: ['CANCELED', 'PAID', 'REFUNDED'] },
        },
        data: {
          status: 'CANCELED',
          statusUpdatedAt: now,
          asaasStatus: 'DELETED',
          liquidacaoStatus: 'NAO_APLICAVEL',
        },
      });
    }
  });
}
