import { NextResponse } from 'next/server';
import { evaluateFinancialOperationalHealth } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { apiJsonError } from '@/lib/api/standard-response';

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

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Job Evaluate Financial Operational Health] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível avaliar a saúde operacional financeira.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
