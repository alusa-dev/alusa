import { NextResponse } from 'next/server';
import { TransferStatus } from '@prisma/client';
import { prisma } from '@alusa/database';
import { reconcileOpenTransfers } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OPEN_TRANSFER_STATUSES: TransferStatus[] = [
  TransferStatus.REQUESTED,
  TransferStatus.PENDING,
  TransferStatus.BLOCKED,
  TransferStatus.PROCESSING,
];

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function listAccountsWithOpenTransfers(maxAccounts: number): Promise<string[]> {
  const rows = await prisma.transferRequest.findMany({
    where: {
      status: { in: OPEN_TRANSFER_STATUSES },
      asaasTransferId: { not: null },
    },
    distinct: ['contaId'],
    orderBy: { statusUpdatedAt: 'asc' },
    take: maxAccounts,
    select: { contaId: true },
  });

  return rows.map((row) => row.contaId);
}

/**
 * GET/POST /api/jobs/reconcile-open-transfers
 *
 * Reconsulta transferências abertas no Asaas fora do caminho de leitura da UI.
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limit = clampPositiveInt(url.searchParams.get('limit'), 20, 100);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 30, 200);
    const minAgeMs = clampPositiveInt(url.searchParams.get('minAgeSeconds'), 30, 24 * 60 * 60) * 1000;
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listAccountsWithOpenTransfers(maxAccounts);

    const results = [];
    for (const contaId of contaIds) {
      const result = await reconcileOpenTransfers({ contaId, limit, minAgeMs });
      results.push({
        contaId,
        reconciled: result.reconciled,
        fetched: result.officialTransfersById.size,
      });
    }

    const reconciled = results.reduce((sum, item) => sum + item.reconciled, 0);
    const fetched = results.reduce((sum, item) => sum + item.fetched, 0);

    return NextResponse.json({
      success: true,
      accountsProcessed: results.length,
      reconciled,
      fetched,
      results,
    });
  } catch (error) {
    console.error('[Job Reconcile Open Transfers] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
