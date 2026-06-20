import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/prisma/client';
import { activateDueRenewalProcesses } from '@/src/server/matriculas/renewal-process.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function run(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
    requireContaIdForCron: true,
  });
  if (!scope.ok) return scope.response;
  if (!scope.contaId) {
    return NextResponse.json(
      { error: { code: 'CONTA_OBRIGATORIA', message: 'contaId é obrigatório.' } },
      { status: 400 },
    );
  }

  const limit = clampPositiveInt(url.searchParams.get('limit'), 25, 100);
  const nowParam = url.searchParams.get('now');
  const now = nowParam ? new Date(nowParam) : new Date();

  if (Number.isNaN(now.getTime())) {
    return NextResponse.json(
      { error: { code: 'DATA_INVALIDA', message: 'Parâmetro now inválido.' } },
      { status: 400 },
    );
  }

  const results = await activateDueRenewalProcesses(
    {
      contaId: scope.contaId,
      now,
      limit,
    },
    { prisma },
  );

  return NextResponse.json({
    success: results.every((item) => item.status === 'EFFECTIVE'),
    processed: results.length,
    results,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
