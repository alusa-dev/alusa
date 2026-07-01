import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PlatformBillingError } from '@alusa/platform-billing';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';
import {
  requestPlatformSubscriptionCancellation,
  undoPlatformSubscriptionCancellation,
} from '@/src/server/platform-billing/plan-change-actions';

const cancelSchema = z.object({
  action: z.enum(['cancel_at_period_end', 'undo_cancel']),
  idempotencyKey: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await req.json().catch(() => null);
  const parsed = cancelSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:cancel:${contaId}:${userId}:${requestIp}`, 20, 10 * 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    try {
      const actionInput = {
        prisma,
        contaId,
        actorUserId: userId,
        idempotencyKey: req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey || randomUUID(),
      };
      const result = parsed.data.action === 'undo_cancel'
        ? await undoPlatformSubscriptionCancellation(actionInput)
        : await requestPlatformSubscriptionCancellation(actionInput);
      console.info('[platform-billing][cancel]', {
        event: parsed.data.action === 'undo_cancel' ? 'cancel_reverted' : 'cancel_scheduled',
        contaId,
        userId,
      });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof PlatformBillingError) {
        return NextResponse.json(
          { error: error.code, message: 'Não foi possível atualizar o cancelamento agora.', details: error.details ?? null },
          { status: 400 },
        );
      }
      throw error;
    }
  });
}
