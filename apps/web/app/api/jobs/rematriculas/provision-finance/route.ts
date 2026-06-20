import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { prisma } from '@/prisma/client';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { provisionFutureFinancialAgreements } from '@/src/server/matriculas/renewal-process.service';
import { processRenewalOutbox } from '@/src/server/matriculas/renewal-outbox.service';

const bodySchema = z.object({
  contaId: z.string().trim().min(1).optional(),
  now: z.string().datetime().or(z.string().date()).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const scope = await resolveTenantScope(request, {
      requestedContaId: body.contaId,
      allowCron: true,
      requireContaIdForCron: true,
    });

    if (!scope.ok) return scope.response;
    if (!scope.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório.');
    }

    const results = await provisionFutureFinancialAgreements(
      {
        contaId: scope.contaId,
        now: parseDate(body.now),
        limit: body.limit,
      },
      { prisma },
    );
    const outboxResults = await processRenewalOutbox(
      {
        contaId: scope.contaId,
        now: parseDate(body.now),
        limit: body.limit,
      },
      { prisma },
    );

    return NextResponse.json(
      {
        processed: results.length,
        results,
        outboxProcessed: outboxResults.length,
        outboxResults,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    return jsonError(
      500,
      'ERRO_PROVISIONAR_FINANCEIRO_FUTURO',
      error instanceof Error ? error.message : 'Erro ao provisionar financeiro futuro.',
    );
  }
}
