import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { checkAccountHealth } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await checkAccountHealth({ contaId: tenantScope.contaId });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Job Asaas Health Check] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível verificar a saúde do provedor financeiro.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
