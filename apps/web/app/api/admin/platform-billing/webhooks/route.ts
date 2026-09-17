import { NextRequest, NextResponse } from 'next/server';
import { platformBillingWebhookListQueryDTOSchema } from '@/features/platform-billing/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';
import { listStripeWebhookEvents } from '@/src/server/platform-billing/webhook-worker';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sessionUser = await requireAdminSession();
  if (!sessionUser) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const url = new URL(req.url);
  const query = platformBillingWebhookListQueryDTOSchema.parse({
    status: url.searchParams.getAll('status').length
      ? url.searchParams.getAll('status')
      : undefined,
    limit: url.searchParams.get('limit'),
  });
  const environment = resolvePlatformBillingEnvironment();

  const events = await listStripeWebhookEvents({
    contaId: sessionUser.contaId,
    environment,
    status: query.status,
    limit: query.limit,
  });

  return NextResponse.json({
    environment,
    events: events.map((event) => ({
      ...event,
      receivedAt: event.receivedAt.toISOString(),
      lastAttemptAt: event.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
      exhaustedAt: event.exhaustedAt?.toISOString() ?? null,
      lastError: event.lastError ? event.lastError.slice(0, 500) : null,
    })),
  });
}

async function requireAdminSession(): Promise<{ id: string; contaId: string } | null> {
  const auth = await resolveTenantSession();
  if (!auth.ok || auth.role?.toUpperCase() !== 'ADMIN') return null;
  return { id: auth.userId, contaId: auth.contaId };
}
