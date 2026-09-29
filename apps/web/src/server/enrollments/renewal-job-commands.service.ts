import { prisma } from '@/src/prisma';
import {
  activateDueRenewalProcesses,
  materializePendingRenewalContracts,
  provisionFutureFinancialAgreements,
} from './renewal-process.service';
import { processRenewalOutbox } from './renewal-outbox.service';
import { runRenewalIntegrityCheck } from './renewal-integrity.service';

export function activateRenewalProcessesFromJob(input: Parameters<typeof activateDueRenewalProcesses>[0]) {
  return activateDueRenewalProcesses(input, { prisma });
}

export function checkRenewalIntegrityFromJob(input: Parameters<typeof runRenewalIntegrityCheck>[0]) {
  return runRenewalIntegrityCheck(input, { prisma });
}

export function processRenewalOutboxFromJob(input: Parameters<typeof processRenewalOutbox>[0]) {
  return processRenewalOutbox(input, { prisma });
}

export function provisionFutureFinancialAgreementsFromJob(
  input: Parameters<typeof provisionFutureFinancialAgreements>[0],
) {
  return provisionFutureFinancialAgreements(input, { prisma });
}

export function materializeRenewalContractsFromJob(
  input: Parameters<typeof materializePendingRenewalContracts>[0],
) {
  return materializePendingRenewalContracts(input, { prisma });
}

export async function listRenewalJobContaIds(input: { maxAccounts: number }) {
  const rows = await prisma.rematriculaProcesso.findMany({
    where: {
      OR: [
        { status: { in: ['CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION'] } },
        { financeiros: { some: { status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED'] } } } },
        { outbox: { some: { status: { in: ['PENDING', 'FAILED'] } } } },
      ],
    },
    distinct: ['contaId'],
    take: input.maxAccounts,
    orderBy: { updatedAt: 'asc' },
    select: { contaId: true },
  });
  return rows;
}
