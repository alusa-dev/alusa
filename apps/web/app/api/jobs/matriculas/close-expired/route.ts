import { NextResponse } from 'next/server';

import { closeExpiredEnrollmentsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { closeExpiredEnrollmentsWithoutSuccessor } from '@/src/server/matriculas/enrollment-closure.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function parseNow(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
}

async function run(req: Request) {
  const url = new URL(req.url);
  const query = closeExpiredEnrollmentsJobQueryDTOSchema.parse({
    contaId: url.searchParams.get('contaId'),
    limit: url.searchParams.get('limit'),
    now: url.searchParams.get('now'),
  });
  const scope = await resolveTenantScope(req, {
    allowCron: true,
    requestedContaId: query.contaId,
    requireContaIdForCron: true,
  });
  if (!scope.ok) return scope.response;
  if (!scope.contaId) {
    return NextResponse.json(
      { error: { code: 'CONTA_OBRIGATORIA', message: 'contaId e obrigatorio.' } },
      { status: 400 },
    );
  }

  try {
    const now = parseNow(query.now ?? null) ?? new Date();
    const result = await closeExpiredEnrollmentsWithoutSuccessor(
      {
        contaId: scope.contaId,
        now,
        limit: query.limit,
      },
    );

    return NextResponse.json({
      success: true,
      ...result,
      closedCount: result.closed.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'ERRO_ENCERRAR_MATRICULAS_EXPIRADAS',
          message: 'Não foi possível encerrar matrículas expiradas.',
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
