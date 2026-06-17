import { NextResponse } from 'next/server';
import {
  rebuildFinanceBillingReadModels,
  refreshFinanceBillingRemoteSnapshots,
} from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limit = clampPositiveInt(url.searchParams.get('limit'), 100, 500);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 100);
    const projection = await rebuildFinanceBillingReadModels({
      contaId: tenantScope.contaId,
      limit,
      maxAccounts,
    });

    const refreshRemote = url.searchParams.get('refreshRemote') === 'true';
    const remote = refreshRemote
      ? await refreshFinanceBillingRemoteSnapshots({
          contaId: tenantScope.contaId,
          limit: clampPositiveInt(url.searchParams.get('remoteLimit'), 25, 100),
          maxAccounts,
          staleOlderThanMinutes: clampPositiveInt(
            url.searchParams.get('staleOlderThanMinutes'),
            360,
            24 * 60,
          ),
        })
      : null;

    return NextResponse.json({
      success: projection.failed === 0 && (!remote || remote.failed === 0),
      projection,
      remote,
    });
  } catch (error) {
    console.error('[Job Rebuild Billing Read Models] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
