import { getFiscalPrisma } from './fiscal-prisma';

export type ChargeRouteRef = {
  chargeId: string;
  cobrancaId: string | null;
};

/**
 * A rota /cobrancas/[id] aceita tanto o id da Cobranca quanto o id da Charge (avulsa/parcela).
 * Use este helper para resolver a charge canônica a partir do parâmetro da URL.
 */
export async function resolveChargeFromRouteRef(
  contaId: string,
  routeRef: string,
): Promise<ChargeRouteRef | null> {
  const prisma = getFiscalPrisma();

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
