import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  listMobileBillingCharges,
  MobileBillingUnauthorizedError,
  type MobileBillingChargesSort,
} from '@/features/billing/server/mobile-billing.service';
import type { MobileBillingCategory } from '@alusa/finance';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const periodSchema = z.enum(['this-month', 'last-30-days']).default('this-month');
const categorySchema = z.enum(['RECEIVED', 'CONFIRMED', 'AWAITING_PAYMENT', 'OVERDUE', 'REFUNDED', 'CANCELLED']).optional();
const originSchema = z.enum(['ACADEMIC', 'STANDALONE']).optional();
const sortSchema = z.enum(['created-at-desc', 'created-at-asc', 'priority', 'due-date-asc', 'due-date-desc', 'amount-desc', 'amount-asc']).default('created-at-desc');
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
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

  const limiter = rateLimit(`mobile-billing:charges:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const params = new URL(request.url).searchParams;
    const categoryParam = params.get('category') ?? undefined;
    const parsedCategory = categorySchema.safeParse(categoryParam);
    if (!parsedCategory.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Categoria inválida.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const category = parsedCategory.data as Exclude<MobileBillingCategory, 'IGNORED'> | undefined;
    const parsedOrigin = originSchema.safeParse(params.get('origin') ?? undefined);
    if (!parsedOrigin.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Origem inválida.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const parsedSort = sortSchema.safeParse(params.get('sort') ?? undefined);
    if (!parsedSort.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Ordenação inválida.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const parsedPeriod = periodSchema.safeParse(params.get('period') ?? undefined);
    if (!parsedPeriod.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Período inválido.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const period = parsedPeriod.data === 'last-30-days' ? 'LAST_30_DAYS' : 'THIS_MONTH';
    const pagination = paginationSchema.safeParse({
      page: params.get('page') ?? undefined,
      pageSize: params.get('pageSize') ?? undefined,
      offset: params.get('offset') ?? undefined,
      limit: params.get('limit') ?? undefined,
    });
    if (!pagination.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Paginação inválida.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const result = await listMobileBillingCharges({
      actor: { userId: actor.userId, contaId: actor.contaId },
      period,
      category,
      origin: parsedOrigin.data,
      search: params.get('q') ?? undefined,
      sort: parsedSort.data as MobileBillingChargesSort,
      page: pagination.data.page,
      pageSize: pagination.data.pageSize,
      offset: pagination.data.offset,
      limit: pagination.data.limit,
    });
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return unauthorized();
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar as cobranças.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
