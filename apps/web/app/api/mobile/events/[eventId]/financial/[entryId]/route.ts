import { updateEventFinancialEntrySchema } from '@alusa/lib';

import { updateMobileEventFinancialEntry } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ eventId: string; entryId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const { eventId, entryId } = await params;
  if (!eventId?.trim() || !entryId?.trim()) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Lançamento não informado.' } }, 400);
  }

  const limiter = rateLimit(`mobile-events:financial-update:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas ações. Aguarde alguns minutos.' } }, 429);
  }

  const parsed = updateEventFinancialEntrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Confira os dados do lançamento.', details: parsed.error.flatten() } }, 422);
  }

  try {
    return response(await updateMobileEventFinancialEntry(actor, eventId, entryId, parsed.data));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível atualizar o lançamento.');
  }
}
