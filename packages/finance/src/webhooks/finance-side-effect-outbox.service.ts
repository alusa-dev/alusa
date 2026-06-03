import { prisma } from '@alusa/database';
import { FinanceWebhookSideEffectStatus } from '@prisma/client';
import type { BillingNotificationCandidate } from '@alusa/lib';
import { emitBillingNotifications } from '@alusa/lib';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;

export type FinanceSideEffectType = 'BILLING_NOTIFICATION';
type EventPublicOrderTicketEmailPayload = {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  eventStartsAt: string;
  ticketCount: number;
  ticketsPath: string;
  statusPath: string;
};

export interface EnqueueBillingNotificationSideEffectsParams {
  contaId: string;
  candidates: BillingNotificationCandidate[];
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
  webhookBatchId?: string;
}

function buildDedupeKey(params: {
  contaId: string;
  effectType: FinanceSideEffectType;
  candidate: BillingNotificationCandidate;
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
}): string {
  const eventKey = params.candidate.eventId?.trim() || `${params.candidate.event}:${params.candidate.asaasPaymentId}`;
  return `${params.contaId}:${params.effectType}:${params.sourceType}:${eventKey}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getAppBaseUrl(): string {
  return trimTrailingSlash(
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000',
  );
}

function buildAppUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(normalizedPath, `${getAppBaseUrl()}/`).toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatEventDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function sendResendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags?: Array<{ name: string; value: string }>;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY ausente em produção.');
    console.info('[EMAIL][DEV_FALLBACK]');
    console.info(`category: event_ticket`);
    console.info(`to: ${params.to}`);
    console.info(`subject: ${params.subject}`);
    console.info(`idempotencyKey: ${params.idempotencyKey}`);
    return { id: null, delivery: 'logged' as const };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM_EVENTS || process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>',
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
      tags: params.tags,
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json?.message === 'string'
        ? json.message
        : Array.isArray(json?.errors)
          ? JSON.stringify(json.errors)
          : `Falha ao enviar e-mail (${response.status}).`;
    if (
      process.env.NODE_ENV !== 'production' &&
      message.includes('You can only send testing emails to your own email address')
    ) {
      console.info('[EMAIL][DEV_FALLBACK]');
      console.info(`category: event_ticket`);
      console.info(`to: ${params.to}`);
      console.info(`subject: ${params.subject}`);
      console.info(`idempotencyKey: ${params.idempotencyKey}`);
      return { id: null, delivery: 'logged' as const };
    }
    throw new Error(message);
  }

  return { id: typeof json?.id === 'string' ? json.id : null, delivery: 'sent' as const };
}

async function sendEventPublicOrderTicketEmail(payload: EventPublicOrderTicketEmailPayload) {
  const ticketsUrl = buildAppUrl(payload.ticketsPath);
  const statusUrl = buildAppUrl(payload.statusPath);
  const eventName = escapeHtml(payload.eventName);
  const buyerName = escapeHtml(payload.buyerName);
  const ticketLabel = payload.ticketCount === 1 ? '1 ingresso' : `${payload.ticketCount} ingressos`;
  const eventDate = escapeHtml(formatEventDate(payload.eventStartsAt));

  const subject = `Seus ingressos para ${payload.eventName}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ee;padding:32px;color:#1f2937;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e7ddd0;border-radius:18px;padding:30px;">
        <p style="margin:0 0 10px;font-size:13px;color:#7c6f60;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">alusa eventos</p>
        <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;color:#271a10;">Ingressos confirmados</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Olá, ${buyerName}. O pagamento foi confirmado e seus ${ticketLabel} para <strong>${eventName}</strong> estão disponíveis.</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#475569;">Data do evento: <strong>${eventDate}</strong></p>
        <a href="${ticketsUrl}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#3e1f63;color:#ffffff;text-decoration:none;font-weight:700;">Baixar ingressos</a>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b;">Você também pode acompanhar o pedido por este link: <a href="${statusUrl}" style="color:#3e1f63;">status do pedido</a>.</p>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8b8378;word-break:break-all;">Se o botão não funcionar, copie e cole este link no navegador:<br />${ticketsUrl}</p>
      </div>
    </div>
  `;
  const text = `Olá, ${payload.buyerName}.\n\nO pagamento foi confirmado e seus ${ticketLabel} para ${payload.eventName} estão disponíveis.\n\nBaixe aqui: ${ticketsUrl}\n\nAcompanhe o pedido: ${statusUrl}`;

  return sendResendEmail({
    to: payload.buyerEmail,
    subject,
    html,
    text,
    idempotencyKey: `event-ticket-email:${payload.orderId}`,
    tags: [
      { name: 'category', value: 'event_ticket' },
      { name: 'order_id', value: payload.orderId },
    ],
  });
}

export async function enqueueBillingNotificationSideEffects(
  params: EnqueueBillingNotificationSideEffectsParams,
): Promise<{ enqueued: number; skipped: number }> {
  if (!params.candidates.length) {
    return { enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;

  for (const candidate of params.candidates) {
    const dedupeKey = buildDedupeKey({
      contaId: params.contaId,
      effectType: 'BILLING_NOTIFICATION',
      candidate,
      sourceType: params.sourceType,
    });

    try {
      await prisma.financeWebhookSideEffectOutbox.create({
        data: {
          contaId: params.contaId,
          effectType: 'BILLING_NOTIFICATION',
          dedupeKey,
          payload: {
            candidate,
            sourceType: params.sourceType,
            webhookBatchId: params.webhookBatchId ?? null,
          },
          status: FinanceWebhookSideEffectStatus.PENDING,
        },
      });
      enqueued += 1;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { enqueued, skipped };
}

export async function processFinanceWebhookSideEffectOutboxEvent(
  eventId: string,
): Promise<{ processed: boolean; reason?: string }> {
  const event = await prisma.financeWebhookSideEffectOutbox.findUnique({
    where: { id: eventId },
  });

  if (!event || event.status === FinanceWebhookSideEffectStatus.PROCESSED) {
    return { processed: false, reason: 'not_found_or_done' };
  }

  const claimed = await prisma.financeWebhookSideEffectOutbox.updateMany({
    where: {
      id: eventId,
      status: { in: [FinanceWebhookSideEffectStatus.PENDING, FinanceWebhookSideEffectStatus.FAILED] },
      availableAt: { lte: new Date() },
    },
    data: {
      status: FinanceWebhookSideEffectStatus.PROCESSING,
      lockedAt: new Date(),
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return { processed: false, reason: 'not_claimed' };
  }

  try {
    if (event.effectType === 'BILLING_NOTIFICATION') {
      const payload = event.payload as {
        candidate: BillingNotificationCandidate;
        sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
      };
      await emitBillingNotifications([payload.candidate], payload.sourceType);
    } else if (event.effectType === 'EVENT_PUBLIC_ORDER_TICKET_EMAIL') {
      await sendEventPublicOrderTicketEmail(event.payload as EventPublicOrderTicketEmailPayload);
    }

    await prisma.financeWebhookSideEffectOutbox.update({
      where: { id: eventId },
      data: {
        status: FinanceWebhookSideEffectStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });

    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = event.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;

    await prisma.financeWebhookSideEffectOutbox.update({
      where: { id: eventId },
      data: {
        status: exhausted
          ? FinanceWebhookSideEffectStatus.FAILED
          : FinanceWebhookSideEffectStatus.PENDING,
        lockedAt: null,
        lastError: message,
        availableAt: exhausted ? event.availableAt : new Date(Date.now() + RETRY_DELAY_MS),
      },
    });

    return { processed: false, reason: message };
  }
}

export async function drainFinanceWebhookSideEffectOutbox(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ attempted: number; processed: number; failed: number }> {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));

  const events = await prisma.financeWebhookSideEffectOutbox.findMany({
    where: {
      status: { in: [FinanceWebhookSideEffectStatus.PENDING, FinanceWebhookSideEffectStatus.FAILED] },
      availableAt: { lte: new Date() },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { availableAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);
    if (result.processed) {
      processed += 1;
    } else if (result.reason && result.reason !== 'not_found_or_done' && result.reason !== 'not_claimed') {
      failed += 1;
    }
  }

  return {
    attempted: events.length,
    processed,
    failed,
  };
}
