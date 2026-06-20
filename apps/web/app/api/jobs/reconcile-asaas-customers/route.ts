import { NextResponse } from 'next/server';
import {
  reconcileAsaasCustomerSnapshots,
  reconcileResponsavelCustomerAddresses,
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

    const limit = clampPositiveInt(url.searchParams.get('limit'), 50, 200);
    const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 20, 100);

    const [snapshots, addresses] = await Promise.all([
      reconcileAsaasCustomerSnapshots({
        contaId: tenantScope.contaId,
        limit,
        maxAccounts,
      }),
      reconcileResponsavelCustomerAddresses({
        contaId: tenantScope.contaId,
        limit,
        maxAccounts,
      }),
    ]);

    return NextResponse.json({
      success: snapshots.failed === 0 && addresses.failed === 0,
      snapshots,
      addresses,
    });
  } catch (error) {
    console.error('[Job Reconcile Asaas Customers] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
