import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/src/prisma';
import { reconcilePendingMatriculaCancellations } from '@/src/server/matriculas/matricula-sync.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: url.searchParams.get('contaId'),
  });
  if (!scope.ok) return scope.response;

  const maxAccounts = clampPositiveInt(url.searchParams.get('maxAccounts'), 25, 100);
  const limit = clampPositiveInt(url.searchParams.get('limit'), 50, 200);
  const contaIds = scope.contaId
    ? [scope.contaId]
    : (
        await prisma.matriculaOperacao.findMany({
          where: {
            tipo: 'CANCELAMENTO',
            status: { in: ['PENDENTE_SINCRONISMO', 'DIVERGENTE', 'ERRO'] },
            conta: { status: 'ATIVO', deletedAt: null },
          },
          select: { contaId: true },
          distinct: ['contaId'],
          orderBy: { contaId: 'asc' },
          take: maxAccounts,
        })
      ).map((item) => item.contaId);

  const results = [];
  const errors: Array<{ contaId: string; error: string }> = [];

  for (const contaId of contaIds) {
    try {
      results.push({
        contaId,
        ...(await reconcilePendingMatriculaCancellations({ prisma, contaId, limit })),
      });
    } catch (error) {
      errors.push({
        contaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    success: true,
    processedAccounts: contaIds.length,
    results,
    errors,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
