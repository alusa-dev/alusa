import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processAsaasProvisioningJobs } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireAdmin: false,
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limitRaw = Number(url.searchParams.get('limit') ?? '10');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 10;

    const result = await processAsaasProvisioningJobs({
      contaId: tenantScope.contaId,
      limit,
    });

    return NextResponse.json({ success: true, processed: result });
  } catch (error) {
    console.error('[Job Provision Asaas Subaccounts] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível provisionar as subcontas financeiras.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
