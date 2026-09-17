import { NextResponse } from 'next/server';
import { evaluateFinancialOperationalHealth } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function run(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await evaluateFinancialOperationalHealth({
      contaId: tenantScope.contaId,
      maxAccounts: clampPositiveInt(url.searchParams.get('maxAccounts'), 50, 200),
    });

    logJobResult('evaluate-financial-operational-health', startedAt, result);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    logJobFailure('evaluate-financial-operational-health', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível avaliar a saúde operacional financeira.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
