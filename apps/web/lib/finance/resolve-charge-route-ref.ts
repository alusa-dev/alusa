import { prisma } from '@alusa/database';

export type ChargeRouteRef = {
  chargeId: string;
  cobrancaId: string | null;
};

/**
 * Resolve a charge a partir do parâmetro /cobrancas/[id], que pode ser cobrancaId ou chargeId.
 */
export async function resolveChargeFromRouteRef(
  contaId: string,
  routeRef: string,
): Promise<ChargeRouteRef | null> {
  const chargeByCobranca = await prisma.charge.findFirst({
    where: { cobrancaId: routeRef, contaId },
    select: { id: true, cobrancaId: true },
  });
  if (chargeByCobranca) {
    return { chargeId: chargeByCobranca.id, cobrancaId: chargeByCobranca.cobrancaId };
  }

  const charge = await prisma.charge.findFirst({
    where: { id: routeRef, contaId },
    select: { id: true, cobrancaId: true },
  });
  if (charge) {
    return { chargeId: charge.id, cobrancaId: charge.cobrancaId };
  }

  return null;
}
