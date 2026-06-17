import { FiscalSyncStatus } from '@prisma/client';
import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@alusa/database';
import { syncFiscalSettingsFromProvider } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
}

async function resolveFiscalAccountsForCron(maxAccounts: number) {
  const rows = await prisma.contaFiscalSettings.findMany({
    where: {
      syncStatus: {
        in: [FiscalSyncStatus.PENDING, FiscalSyncStatus.DIVERGED],
      },
    },
    select: { contaId: true, syncStatus: true, updatedAt: true },
    orderBy: [{ syncStatus: 'desc' }, { updatedAt: 'asc' }],
    take: maxAccounts,
  });

  return rows.map((row) => row.contaId);
}

/**
 * GET/POST /api/jobs/reconcile-fiscal-settings
 *
 * Reconcilia as configurações fiscais locais com o snapshot oficial do Asaas.
 *
 * Query params:
 * - contaId (opcional): processa apenas uma conta, validada contra sessão ou cron token
 * - maxAccounts (opcional): limite do cron multi-tenant, default 20
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 50);
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await resolveFiscalAccountsForCron(maxAccounts);

    const results = await Promise.allSettled(
      contaIds.map(async (contaId) => ({
        contaId,
        result: await syncFiscalSettingsFromProvider({ contaId }),
      })),
    );

    const reconciled = results.map((item, index) => {
      const contaId = contaIds[index];
      if (item.status === 'rejected') {
        return {
          contaId,
          success: false,
          error: item.reason instanceof Error ? item.reason.message : 'Erro interno',
        };
      }

      return {
        contaId,
        success: item.value.result.success,
        data: item.value.result.success ? item.value.result.data : null,
        error: item.value.result.success ? null : item.value.result.error,
      };
    });

    return NextResponse.json({
      success: reconciled.every((item) => item.success),
      mode: tenantScope.contaId ? 'single-account' : 'cron',
      processed: reconciled.length,
      reconciled,
    });
  } catch (error) {
    console.error('[Job Reconcile Fiscal Settings] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
