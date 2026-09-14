import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { getMobileEventCostumeResources } from '@/features/events/server/mobile-events.service';
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

  const limiter = rateLimit(`mobile-events:costumes:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);
  }

  try {
    return response(await getMobileEventCostumeResources(actor, eventId));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível carregar os figurinos do evento.');
  }
}
