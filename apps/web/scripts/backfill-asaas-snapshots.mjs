/**
 * Backfill de snapshots Asaas (asaasStatus, liquidacaoStatus) via pipeline canônico.
 *
 * Runbook operacional:
 * 1. Rodar reconcile de links: node apps/web/scripts/reconcile-operational-charges.mjs <contaId>
 * 2. Rodar backfill de snapshot: node apps/web/scripts/backfill-asaas-snapshots.mjs <contaId> [--dry-run] [--limit=100]
 * 3. Validar amostra no admin (badge Confirmada/Recebida) e no painel Asaas
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;
const contaIdArg = process.argv.find((arg) => !arg.startsWith('-') && arg !== process.argv[1]);

async function main() {
  const { backfillAsaasPaymentSnapshots } = require('@alusa/finance/dist/use-cases/backfill-asaas-payment-snapshots.js');
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

    const result = await backfillAsaasPaymentSnapshots({
      contaId,
      dryRun,
      limit,
      actor: { type: 'SYSTEM', id: 'backfill-asaas-snapshots.mjs' },
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
