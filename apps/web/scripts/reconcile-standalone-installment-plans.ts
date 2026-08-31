import { reconcileStandaloneInstallmentPlanStatuses } from '@alusa/lib/services/standalone-installment-plan-status.service';

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dryRun = !process.argv.includes('--apply');
const contaId = readOption('--conta-id');
const limitValue = Number(readOption('--limit') ?? '100');

if (process.env.NODE_ENV !== 'production') {
  throw new Error('Esta rotina só pode ser executada com NODE_ENV=production.');
}

const result = await reconcileStandaloneInstallmentPlanStatuses({
  contaId,
  dryRun,
  limit: Number.isFinite(limitValue) ? limitValue : 100,
});

console.info(JSON.stringify({
  ...result,
  mode: dryRun ? 'dry-run' : 'apply',
  contaId: contaId ?? 'all',
}, null, 2));
