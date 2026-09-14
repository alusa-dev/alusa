import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getMobileStatement,
  MobileStatementUnauthorizedError,
} from '@/features/financeiro/server/mobile-extrato.service';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const querySchema = z.object({
  period: z.enum(['this-month', 'last-30-days']).default('this-month'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
});

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-statement:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    period: params.get('period') ?? undefined,
    direction: params.get('direction') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_QUERY', message: 'Os filtros informados não são válidos.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const gate = await guardFinancialAccountOr412(actor.contaId);
    if (!gate.ok) return gate.response;

    const statement = await getMobileStatement({
      actor: { userId: actor.userId, contaId: actor.contaId },
      period: parsed.data.period === 'last-30-days' ? 'LAST_30_DAYS' : 'THIS_MONTH',
      direction: parsed.data.direction,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });

    return NextResponse.json(statement, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileStatementUnauthorizedError) return unauthorized();
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar o extrato agora.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
