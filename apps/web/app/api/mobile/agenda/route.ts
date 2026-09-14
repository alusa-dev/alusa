import { NextResponse } from 'next/server';

import {
  createCalendarEventInputSchema,
  listCalendarEventsQuerySchema,
} from '@/features/aulas/dtos';
import {
  createMobileAgendaEvent,
  listMobileAgendaEvents,
  MobileAgendaForbiddenError,
  MobileAgendaUnauthorizedError,
} from '@/features/aulas/server/mobile-agenda.service';
import { knownMobileAgendaError } from '@/features/aulas/server/mobile-agenda-route-utils';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function unauthorized() {
  return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
}

function forbidden(message = 'Você não tem permissão para acessar a agenda.') {
  return response({ error: { code: 'FORBIDDEN', message } }, 403);
}

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-agenda:list:${actor.userId}:${ipFromRequest(request)}`, 90, 10 * 60 * 1000);
  if (!limiter.ok) return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);

  const { searchParams } = new URL(request.url);
  const parsed = listCalendarEventsQuerySchema.safeParse({
    start: searchParams.get('start') ?? undefined,
    end: searchParams.get('end') ?? undefined,
    turmaId: searchParams.get('turmaId') ?? undefined,
    professorId: searchParams.get('professorId') ?? undefined,
    salaId: searchParams.get('salaId') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    viewMode: searchParams.get('viewMode') ?? undefined,
    includeResources: searchParams.get('includeResources') ?? undefined,
  });

  if (!parsed.success) return response({ error: { code: 'INVALID_QUERY', message: 'Parâmetros inválidos.' } }, 400);

  try {
    return response(await listMobileAgendaEvents({ userId: actor.userId, contaId: actor.contaId }, parsed.data));
  } catch (error) {
    const knownError = knownMobileAgendaError(error);
    if (knownError) return response(knownError.body, knownError.status);
    if (error instanceof MobileAgendaUnauthorizedError) return unauthorized();
    if (error instanceof MobileAgendaForbiddenError) return forbidden(error.message);
    console.error('[mobile-agenda][list]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar a agenda.' } }, 500);
  }
}

export async function POST(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-agenda:create:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);

  const parsed = createCalendarEventInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: 'Confira os dados do evento.' } }, 422);

  try {
    return response(
      await createMobileAgendaEvent({ userId: actor.userId, contaId: actor.contaId }, parsed.data),
      201,
    );
  } catch (error) {
    const knownError = knownMobileAgendaError(error);
    if (knownError) return response(knownError.body, knownError.status);
    if (error instanceof MobileAgendaUnauthorizedError) return unauthorized();
    if (error instanceof MobileAgendaForbiddenError) return forbidden(error.message);
    console.error('[mobile-agenda][create]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'OPERATION_FAILED', message: 'Não foi possível criar o evento.' } }, 409);
  }
}
