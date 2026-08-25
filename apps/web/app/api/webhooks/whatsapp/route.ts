import { NextResponse } from 'next/server';
import {
  hashWebhookBody,
  verifyMetaWebhookChallenge,
  verifyMetaWebhookSignature,
} from '@alusa/whatsapp';
import { ingestWhatsAppWebhook } from '@/src/server/whatsapp/outbox.service';
import { getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = verifyMetaWebhookChallenge({
    mode: url.searchParams.get('hub.mode'),
    token: url.searchParams.get('hub.verify_token'),
    challenge: url.searchParams.get('hub.challenge'),
    verifyToken: getWhatsAppRuntimeConfig().verifyToken,
  });

  return challenge === null
    ? NextResponse.json({ error: 'Webhook verification failed.' }, { status: 403 })
    : new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 2_000_000) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }

  const config = getWhatsAppRuntimeConfig();
  const validSignature = verifyMetaWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get('x-hub-signature-256'),
    appSecret: config.appSecret,
  });
  if (!validSignature) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  try {
    const payloadHash = hashWebhookBody(rawBody);
    const result = await ingestWhatsAppWebhook({
      eventKey: `meta:${payloadHash}`,
      payloadHash,
      payload,
    });

    return NextResponse.json({ received: true, eventId: result.id, status: result.status }, { status: 200 });
  } catch (error) {
    console.error('[whatsapp-webhook] Falha ao persistir evento', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Webhook could not be persisted.' }, { status: 500 });
  }
}
