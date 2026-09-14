import { createCostumeAssignmentSchema } from '@alusa/lib';

import { createMobileCostumeAssignment } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId } = await params;
  if (!eventId?.trim()) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Evento não informado.' } }, 400);
  }

  const limiter = rateLimit(`mobile-events:costume-assignment:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas ações. Aguarde alguns minutos.' } }, 429);
  }

  const payload = await request.json().catch(() => null);
  const parsed = createCostumeAssignmentSchema.safeParse({
    ...(payload && typeof payload === 'object' ? payload : {}),
    eventId,
  });
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Confira os dados do vínculo.', details: parsed.error.flatten() } }, 422);
  }

  try {
    return response(await createMobileCostumeAssignment(actor, eventId, parsed.data), 201);
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível vincular o figurino.');
  }
}
