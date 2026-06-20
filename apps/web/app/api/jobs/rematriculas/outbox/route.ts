import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/prisma/client';
import { processRenewalOutbox } from '@/src/server/matriculas/renewal-outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

function parseNow(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
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

  try {
    const results = await processRenewalOutbox(
      {
        contaId: scope.contaId,
        now: parseNow(url.searchParams.get('now')),
        limit: clampPositiveInt(url.searchParams.get('limit'), 25, 100),
      },
      { prisma },
    );

    return NextResponse.json({
      success: results.every((item) => item.status !== 'FAILED'),
      processed: results.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'ERRO_PROCESSAR_OUTBOX_REMATRICULA',
          message: error instanceof Error ? error.message : 'Erro ao processar outbox.',
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

