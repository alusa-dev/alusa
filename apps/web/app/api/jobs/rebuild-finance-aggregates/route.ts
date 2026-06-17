import { NextResponse } from 'next/server';
import { rebuildFinanceAggregates } from '@alusa/finance';

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

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await rebuildFinanceAggregates({
      contaId: tenantScope.contaId,
      days: clampPositiveInt(url.searchParams.get('days'), 90, 370),
      maxAccounts: clampPositiveInt(url.searchParams.get('maxAccounts'), 50, 200),
      startDate: parseDate(url.searchParams.get('startDate')),
      endDate: parseDate(url.searchParams.get('endDate')),
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Job Rebuild Finance Aggregates] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
