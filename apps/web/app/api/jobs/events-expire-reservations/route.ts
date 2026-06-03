import { NextResponse } from 'next/server';

import { expireEventMapReservations } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(req: Request) {
  const url = new URL(req.url);
  const tenantScope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
  });
  if (!tenantScope.ok) return tenantScope.response;

  const result = await expireEventMapReservations({
    contaId: tenantScope.contaId,
    limit: toPositiveInt(url.searchParams.get('limit'), 100, 500),
    maxAccounts: toPositiveInt(url.searchParams.get('maxAccounts'), 20, 50),
  });

  return NextResponse.json({ success: true, job: result });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
