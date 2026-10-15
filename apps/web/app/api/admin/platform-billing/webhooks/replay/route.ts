import { NextRequest, NextResponse } from 'next/server';
import { platformBillingWebhookReplayInputDTOSchema } from '@/features/platform-billing/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { replayPlatformBillingNotifications, replayStripeWebhookEvents } from '@/src/server/platform-billing/webhook-worker';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const sessionUser = await requireAdminSession();
  if (!sessionUser) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = platformBillingWebhookReplayInputDTOSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() }, { status: 400 });
  }

  const environment = resolvePlatformBillingEnvironment();
  const [events, notifications] = await Promise.all([
    parsed.data.ids?.length ? replayStripeWebhookEvents({
      ids: parsed.data.ids,
      contaId: sessionUser.contaId,
      actorUserId: sessionUser.id,
      reason: parsed.data.reason,
      environment,
    }) : Promise.resolve({ replayed: 0 }),
    parsed.data.notificationIds?.length ? replayPlatformBillingNotifications({
      ids: parsed.data.notificationIds,
      contaId: sessionUser.contaId,
      actorUserId: sessionUser.id,
      reason: parsed.data.reason,
      environment,
    }) : Promise.resolve({ replayed: 0 }),
  ]);

  return NextResponse.json({ events, notifications });
}

async function requireAdminSession(): Promise<{ id: string; contaId: string } | null> {
  const auth = await resolveTenantSession();
  if (!auth.ok || auth.role?.toUpperCase() !== 'ADMIN') return null;
  return { id: auth.userId, contaId: auth.contaId };
}
