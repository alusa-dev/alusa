/**
 * @deprecated Use o use case canônico reconcileOperationalChargeLinks (@alusa/finance).
 *
 * Uso:
 *   node apps/web/scripts/reconcile-operational-charges.mjs [contaId] [--dry-run] [--force-snapshot]
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const dryRun = process.argv.includes('--dry-run');
const forceSnapshot = process.argv.includes('--force-snapshot');
const contaIdArg = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[1]);

async function main() {
  const { reconcileOperationalChargeLinks } = require(
    join(repoRoot, 'packages/finance/dist/use-cases/reconcile-operational-charge-links.js'),
  );
  const { backfillAsaasPaymentSnapshots } = require(
    join(repoRoot, 'packages/finance/dist/use-cases/backfill-asaas-payment-snapshots.js'),
  );
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    let contaId = contaIdArg;
    if (!contaId) {
      const profile = await prisma.financeProfile.findFirst({
        where: { asaasAccount: { apiKeyStatus: 'CONNECTED' } },
        select: { contaId: true, conta: { select: { nome: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      if (!profile?.contaId) {
        throw new Error('Informe contaId como argumento ou conecte uma subconta Asaas.');
      }
      contaId = profile.contaId;
      console.log(`Usando conta: ${profile.conta?.nome ?? contaId} (${contaId})`);
    }

    console.log('[reconcile-operational-charges] links', { contaId, dryRun, forceSnapshot });
    const linkResult = await reconcileOperationalChargeLinks({
      contaId,
      dryRun,
      forceSnapshot,
      actor: { type: 'SYSTEM', id: 'reconcile-operational-charges.mjs' },
    });
    console.log(JSON.stringify(linkResult, null, 2));

    if (forceSnapshot) {
      console.log('[reconcile-operational-charges] snapshot backfill');
      const backfillResult = await backfillAsaasPaymentSnapshots({
        contaId,
        dryRun,
        limit: 100,
        actor: { type: 'SYSTEM', id: 'reconcile-operational-charges.mjs' },
      });
      console.log(JSON.stringify(backfillResult, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
