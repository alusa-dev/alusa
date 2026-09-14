import { z } from 'zod';

import { verifyMobileTicketByCode } from '@/features/events/server/mobile-events.service';
import {
  authenticate,
  handleMobileEventsError,
  response,
  unauthorized,
} from '@/features/events/server/mobile-events-route-utils';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  ticketCode: z.string().trim().min(4).max(128),
  confirm: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const actor = await authenticate(request);
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-tickets:verify:${actor.userId}:${ipFromRequest(request)}`, 120, 10 * 60 * 1000);
  if (!limiter.ok) {
    return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return response({ error: { code: 'INVALID_INPUT', message: 'Informe um código de ingresso válido.' } }, 422);
  }

  try {
    return response(await verifyMobileTicketByCode(actor, parsed.data.ticketCode, parsed.data.confirm));
  } catch (error) {
    return handleMobileEventsError(error, 'Não foi possível validar este ingresso.');
  }
}
