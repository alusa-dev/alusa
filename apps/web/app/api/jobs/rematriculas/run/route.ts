import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/prisma/client';
import {
  activateDueRenewalProcesses,
  materializePendingRenewalContracts,
  provisionFutureFinancialAgreements,
} from '@/src/server/matriculas/renewal-process.service';
import { processRenewalOutbox } from '@/src/server/matriculas/renewal-outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function clamp(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function run(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
    requireContaIdForCron: false,
  });
  if (!scope.ok) return scope.response;

  const now = new Date();
  const maxAccounts = clamp(url.searchParams.get('maxAccounts'), 25, 100);
  const perAccountLimit = clamp(url.searchParams.get('limit'), 25, 100);

  const accountRows = scope.contaId
    ? [{ contaId: scope.contaId }]
    : await prisma.rematriculaProcesso.findMany({
        where: {
          OR: [
            { status: { in: ['CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION'] } },
            { financeiros: { some: { status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED'] } } } },
            { outbox: { some: { status: { in: ['PENDING', 'FAILED'] } } } },
          ],
        },
        distinct: ['contaId'],
        take: maxAccounts,
        orderBy: { updatedAt: 'asc' },
        select: { contaId: true },
      });

  const results = [];
  for (const { contaId } of accountRows) {
    try {
      const contracts = await materializePendingRenewalContracts(
        { contaId, limit: perAccountLimit },
        { prisma },
      );
      const queued = await provisionFutureFinancialAgreements(
        { contaId, now, limit: perAccountLimit },
        { prisma },
      );
      const outbox = await processRenewalOutbox(
        { contaId, now, limit: perAccountLimit },
        { prisma },
      );
      const activated = await activateDueRenewalProcesses(
        { contaId, now, limit: perAccountLimit },
        { prisma },
      );
      results.push({ contaId, success: true, contracts, queued, outbox, activated });
    } catch (error) {
      results.push({
        contaId,
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  return NextResponse.json({
    success: results.every((result) => result.success),
    processedAccounts: results.length,
    results,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
