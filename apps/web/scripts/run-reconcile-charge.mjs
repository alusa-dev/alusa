/**
 * @deprecated Use syncPaymentStateFromAsaas / reconcileOperationalChargeLinks.
 *
 * One-off helper — passe CHARGE_ID como variável de ambiente:
 *   CHARGE_ID=ch_xxx node apps/web/scripts/run-reconcile-charge.mjs
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

async function main() {
  const chargeId = process.env.CHARGE_ID;
  if (!chargeId) {
    throw new Error('Defina CHARGE_ID=<chargeId>');
  }

  const { PrismaClient } = require('@prisma/client');
  const { syncPaymentStateFromAsaas } = require('@alusa/finance/dist/use-cases/sync-payment-state-from-asaas.js');
  const prisma = new PrismaClient();

  try {
    const charge = await prisma.charge.findFirst({
      where: { id: chargeId },
      select: { id: true, contaId: true, asaasPaymentId: true, status: true },
    });

    if (!charge?.asaasPaymentId) {
      throw new Error(`Charge ${chargeId} não encontrada ou sem asaasPaymentId`);
    }

    console.log('--- Antes ---', charge);
    const result = await syncPaymentStateFromAsaas({
      contaId: charge.contaId,
      asaasPaymentId: charge.asaasPaymentId,
      actor: { type: 'SYSTEM', id: 'run-reconcile-charge.mjs' },
    });
    console.log('--- Resultado ---', result);

    const after = await prisma.charge.findFirst({
      where: { id: chargeId },
      select: {
        id: true,
        status: true,
        asaasStatus: true,
        liquidacaoStatus: true,
        lastAsaasFetchAt: true,
      },
    });
    console.log('--- Depois ---', after);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
