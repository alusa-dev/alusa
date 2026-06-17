import { NextResponse } from 'next/server';
import { prisma } from '@alusa/database';
import { syncPaymentStateFromAsaas } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ACTIVE_ASAAS_STATUSES = [
  'PENDING',
  'OVERDUE',
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'AWAITING_RISK_ANALYSIS',
];

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function listCandidateContaIds(maxAccounts: number): Promise<string[]> {
  const [academic, standalone] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        asaasPaymentId: { not: null },
        OR: [
          { lastAsaasFetchAt: null },
          { asaasStatus: { in: ACTIVE_ASAAS_STATUSES } },
        ],
      },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: maxAccounts,
      select: { contaId: true },
    }),
    prisma.charge.findMany({
      where: {
        asaasPaymentId: { not: null },
        OR: [
          { lastAsaasFetchAt: null },
          { asaasStatus: { in: ACTIVE_ASAAS_STATUSES } },
        ],
      },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: maxAccounts,
      select: { contaId: true },
    }),
  ]);

  return Array.from(new Set([...academic, ...standalone].map((row) => row.contaId))).slice(0, maxAccounts);
}

async function collectPaymentIds(params: {
  contaId: string;
  limit: number;
  staleBefore: Date;
}): Promise<string[]> {
  const [academic, standalone] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        contaId: params.contaId,
        asaasPaymentId: { not: null },
        OR: [
          { lastAsaasFetchAt: null },
          { lastAsaasFetchAt: { lt: params.staleBefore } },
        ],
      },
      orderBy: [{ lastAsaasFetchAt: 'asc' }, { updatedAt: 'asc' }],
      take: params.limit,
      select: { asaasPaymentId: true },
    }),
    prisma.charge.findMany({
      where: {
        contaId: params.contaId,
        asaasPaymentId: { not: null },
        OR: [
          { lastAsaasFetchAt: null },
          { lastAsaasFetchAt: { lt: params.staleBefore } },
        ],
      },
      orderBy: [{ lastAsaasFetchAt: 'asc' }, { updatedAt: 'asc' }],
      take: params.limit,
      select: { asaasPaymentId: true },
    }),
  ]);

  return Array.from(
    new Set(
      [...academic, ...standalone]
        .map((row) => row.asaasPaymentId)
        .filter((paymentId): paymentId is string => Boolean(paymentId)),
    ),
  ).slice(0, params.limit);
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limit = clampPositiveInt(url.searchParams.get('limit'), 50, 200);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 100);
    const staleOlderThanMinutes = clampPositiveInt(
      url.searchParams.get('staleOlderThanMinutes'),
      30,
      24 * 60,
    );
    const staleBefore = new Date(Date.now() - staleOlderThanMinutes * 60_000);
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listCandidateContaIds(maxAccounts);

    const results = [];
    for (const contaId of contaIds) {
      const paymentIds = await collectPaymentIds({ contaId, limit, staleBefore });
      let success = 0;
      let failed = 0;

      for (const asaasPaymentId of paymentIds) {
        const result = await syncPaymentStateFromAsaas({
          contaId,
          asaasPaymentId,
          intent: 'RECONCILIATION',
        }).catch((error) => ({
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        }));

        if (result.success) success++;
        else failed++;
      }

      results.push({ contaId, attempted: paymentIds.length, success, failed });
    }

    return NextResponse.json({
      success: results.every((item) => item.failed === 0),
      processedAccounts: results.length,
      attempted: results.reduce((sum, item) => sum + item.attempted, 0),
      successCount: results.reduce((sum, item) => sum + item.success, 0),
      failedCount: results.reduce((sum, item) => sum + item.failed, 0),
      results,
    });
  } catch (error) {
    console.error('[Job Reconcile Portal Finance] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
