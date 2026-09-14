import { getMobileEvent } from '@/features/events/server/mobile-events.service';
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
  const limiter = rateLimit(`mobile-events:detail:${actor.userId}:${ipFromRequest(request)}`, 120, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  if (!eventId?.trim()) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Evento não informado.' } }, 400);
  }

  try {
    return response(await getMobileEvent(actor, eventId));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível carregar o evento.');
  }
}
