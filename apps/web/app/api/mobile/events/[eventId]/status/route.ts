import { z } from 'zod';

import { finishMobileEvent, reactivateMobileEvent } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const bodySchema = z.object({ status: z.enum(['FINISHED', 'ACTIVE']) });
type RouteParams = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId } = await params;
  if (!eventId?.trim()) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Evento não informado.' } }, 400);
  }

  const limiter = rateLimit(`mobile-events:status:${actor.userId}:${ipFromRequest(request)}`, 10, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas ações. Aguarde alguns minutos.' } }, 429);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'A ação solicitada não é válida.' } }, 422);
  }

  try {
    const result = parsed.data.status === 'FINISHED'
      ? await finishMobileEvent(actor, eventId)
      : await reactivateMobileEvent(actor, eventId);
    return response(result);
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível atualizar o status do evento.');
  }
}
