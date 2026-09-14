import { listSchoolEventsQuerySchema } from '@alusa/lib';

import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { listMobileEvents } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-events:list:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = listSchoolEventsQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    hasTickets: searchParams.get('hasTickets') ?? undefined,
  });

  if (!parsed.success) {
    return response({ error: { code: 'INVALID_QUERY', message: 'Os filtros dos eventos não são válidos.' } }, 400);
  }

  try {
    return response(await listMobileEvents(actor, parsed.data));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível carregar os eventos.');
  }
}
