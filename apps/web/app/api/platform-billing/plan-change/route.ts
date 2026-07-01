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
import { requestPlatformPlanChange } from '@/src/server/platform-billing/plan-change-actions';

const planChangeSchema = z.object({
  targetPlanCode: z.enum(['STARTER', 'PREMIUM', 'PRO']),
  idempotencyKey: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await req.json().catch(() => null);
  const parsed = planChangeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:plan-change:${contaId}:${userId}:${requestIp}`, 20, 10 * 60_000);
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
      const result = await requestPlatformPlanChange({
        prisma,
        contaId,
        actorUserId: userId,
        targetPlanCode: parsed.data.targetPlanCode,
        idempotencyKey: req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey || randomUUID(),
      });
      console.info('[platform-billing][plan-change]', {
        event: result.type === 'UPGRADE' ? 'upgrade_requested' : 'downgrade_scheduled',
        contaId,
        userId,
        targetPlanCode: parsed.data.targetPlanCode,
        planChangeId: result.planChangeId,
      });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof PlatformBillingError) {
        return NextResponse.json(
          {
            error: error.code,
            message: error.code === 'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE'
              ? 'Este plano não atende ao uso atual da conta.'
              : 'Não foi possível alterar o plano agora.',
            details: error.details ?? null,
          },
          { status: error.code === 'PLATFORM_BILLING_PLAN_CHANGE_INCOMPATIBLE' ? 422 : 400 },
        );
      }
      throw error;
    }
  });
}
