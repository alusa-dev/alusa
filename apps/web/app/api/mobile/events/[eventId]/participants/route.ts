import { listEventParticipantsQuerySchema } from '@alusa/lib/events/events.schema';

import { listMobileEventParticipants } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId } = await params;
  if (!eventId?.trim()) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Evento não informado.' } }, 400);
  }

  const limiter = rateLimit(`mobile-events:participants-list:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = listEventParticipantsQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_QUERY', message: 'A paginação ou os filtros dos alunos inscritos não são válidos.' } }, 400);
  }

  try {
    return response(await listMobileEventParticipants(actor, eventId, parsed.data));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível carregar os alunos inscritos.');
  }
}
