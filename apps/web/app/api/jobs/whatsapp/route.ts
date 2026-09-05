import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { drainContractWhatsAppNotifications, drainWhatsAppOutbox, drainWhatsAppWebhooks } from '@/src/server/whatsapp/outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(request: Request) {
  const auth = await resolveTenantScope(request, { allowCron: true });
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const contractNotifications = await drainContractWhatsAppNotifications({
    limit: Number(url.searchParams.get('contractLimit') ?? '50'),
  });
  const outbox = await drainWhatsAppOutbox({
    limit: Number(url.searchParams.get('outboxLimit') ?? '50'),
  });
  const webhooks = await drainWhatsAppWebhooks({
    limit: Number(url.searchParams.get('webhookLimit') ?? '100'),
  });

  return NextResponse.json({ success: true, contractNotifications, outbox, webhooks });
}

export async function GET(request: Request) {
  try {
    return await run(request);
  } catch (error) {
    console.error('[whatsapp-job] Falha no worker', { error: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ error: 'WhatsApp worker failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
