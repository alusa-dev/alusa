import {
  createEventFinancialEntrySchema,
  listFinancialEntriesQuerySchema,
} from '@alusa/lib/events/events.schema';

import {
  createMobileEventFinancialEntry,
  listMobileEventFinancialEntries,
} from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ eventId: string }> };

function invalidEventId() {
  return response({ error: { code: 'INVALID_INPUT', message: 'Evento não informado.' } }, 400);
}

export async function GET(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId } = await params;
  if (!eventId?.trim()) return invalidEventId();

  const searchParams = new URL(request.url).searchParams;
  const parsedQuery = listFinancialEntriesQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });
  if (!parsedQuery.success) return response({ error: { code: 'INVALID_QUERY', message: 'A paginação ou os filtros dos lançamentos não são válidos.' } }, 400);

  const limiter = rateLimit(`mobile-events:financial-list:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  try {
    return response(await listMobileEventFinancialEntries(
      actor,
      eventId,
      parsedQuery.data.page,
      Math.min(parsedQuery.data.pageSize, 10),
      { type: parsedQuery.data.type, status: parsedQuery.data.status, search: parsedQuery.data.search },
    ));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível carregar os lançamentos do evento.');
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId } = await params;
  if (!eventId?.trim()) return invalidEventId();

  const limiter = rateLimit(`mobile-events:financial-create:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas ações. Aguarde alguns minutos.' } }, 429);
  }

  const payload = await request.json().catch(() => null);
  const parsed = createEventFinancialEntrySchema.safeParse({
    ...(payload && typeof payload === 'object' ? payload : {}),
    eventId,
  });
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Confira os dados do lançamento.', details: parsed.error.flatten() } }, 422);
  }

  try {
    return response(await createMobileEventFinancialEntry(actor, eventId, parsed.data), 201);
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível registrar o lançamento.');
  }
}
