import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';
import { FinanceWebhookSideEffectStatus, Prisma } from '@prisma/client';
import {
  buildBillingNotificationDedupeKey,
  normalizeBillingNotificationEvent,
} from '@alusa/lib/services/notifications.service';
import {
  emitBillingNotifications,
  type BillingNotificationCandidate,
} from '@alusa/lib/notifications/emit-billing-notifications';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 30 * 60_000;
const SIDE_EFFECT_LEASE_MS = 10 * 60 * 1000;
const EVENT_TICKET_TEMPLATE_ID =
  process.env.RESEND_EVENT_TICKET_TEMPLATE_ID || 'c395cbe5-b1fb-4d2d-ae3f-825e1e0d94e0';
const EVENT_TIME_ZONE = process.env.APP_TIMEZONE || 'America/Manaus';

class SideEffectDeliveryError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.retryable = retryable;
    this.name = 'SideEffectDeliveryError';
  }
}

export type FinanceSideEffectType =
  | 'BILLING_NOTIFICATION'
  | 'EVENT_PUBLIC_ORDER_TICKET_EMAIL'
  | 'EVENT_PUBLIC_ORDER_CREATED_EMAIL';

export type FinanceSideEffectSourceType =
  | 'ASAAS_WEBHOOK'
  | 'ASAAS_SYNC'
  | 'FINANCE_EFFECT'
  | 'EVENT_ORDER';

export interface EnqueueFinanceSideEffectParams {
  contaId: string;
  effectType: FinanceSideEffectType;
  dedupeKey: string;
  payload: Prisma.InputJsonObject;
}
type EventPublicOrderTicketEmailPayload = {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  eventStartsAt: string;
  eventLocation?: string | null;
  ticketType?: string | null;
  ticketCount: number;
  ticketsPath: string;
  ticketsHtmlPath?: string | null;
  statusPath?: string | null;
  deliveryKey?: string;
};

type EventPublicOrderCreatedEmailPayload = {
  orderId: string;
  buyerEmail: string;
  buyerName: string;
  eventName: string;
  eventStartsAt: string;
  statusPath: string;
  invoiceUrl: string | null;
  paymentMethod: string;
  expiresAt: string;
};

export interface EnqueueBillingNotificationSideEffectsParams {
  contaId: string;
  candidates: BillingNotificationCandidate[];
  sourceType: Extract<FinanceSideEffectSourceType, 'ASAAS_WEBHOOK' | 'ASAAS_SYNC'>;
  webhookBatchId?: string;
}

function buildDedupeKey(params: {
  contaId: string;
  effectType: FinanceSideEffectType;
  candidate: BillingNotificationCandidate;
  sourceType: Extract<FinanceSideEffectSourceType, 'ASAAS_WEBHOOK' | 'ASAAS_SYNC'>;
}): string {
  if (params.effectType === 'BILLING_NOTIFICATION') {
    const normalizedEvent = normalizeBillingNotificationEvent(params.candidate.event);
    if (normalizedEvent) {
      return `${params.contaId}:${params.effectType}:${buildBillingNotificationDedupeKey(
        normalizedEvent,
        params.candidate.asaasPaymentId,
      )}`;
    }
  }

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

function formatEventTemplateDateParts(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('pt-BR', {
      timeZone: EVENT_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('pt-BR', {
      timeZone: EVENT_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
  };
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
    throw new Error('RESEND_API_KEY ausente; e-mail não foi enviado.');
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
    throw new SideEffectDeliveryError(message, response.status === 429 || response.status >= 500);
  }

  return { id: typeof json?.id === 'string' ? json.id : null, delivery: 'sent' as const };
}

async function sendResendTemplateEmail(params: {
  to: string;
  variables: Record<string, string>;
  idempotencyKey: string;
  tags?: Array<{ name: string; value: string }>;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY ausente; e-mail não foi enviado.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM_EVENTS || process.env.EMAIL_FROM_INVITES || process.env.EMAIL_FROM_AUTH || 'Alusa <onboarding@resend.dev>',
      to: [params.to],
      template: {
        id: EVENT_TICKET_TEMPLATE_ID,
        variables: params.variables,
      },
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
    throw new SideEffectDeliveryError(message, response.status === 429 || response.status >= 500);
  }

  return { id: typeof json?.id === 'string' ? json.id : null, delivery: 'sent' as const };
}

async function sendEventPublicOrderTicketEmail(payload: EventPublicOrderTicketEmailPayload) {
  const eventDate = formatEventTemplateDateParts(payload.eventStartsAt);
  const ticketsUrl = buildAppUrl(payload.ticketsPath);
  const supportUrl = process.env.EMAIL_SUPPORT_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://alusa.app';

  return sendResendTemplateEmail({
    to: payload.buyerEmail,
    idempotencyKey: `event-ticket-email:${payload.orderId}:${payload.deliveryKey ?? 'initial'}`,
    variables: {
      BUYER_NAME: payload.buyerName,
      EVENT_NAME: payload.eventName,
      EVENT_DATE: eventDate.date,
      EVENT_TIME: eventDate.time,
      EVENT_LOCATION: payload.eventLocation || 'A confirmar',
      TICKET_TYPE: payload.ticketType || 'Ingresso',
      TICKETS_URL: ticketsUrl,
      SUPPORT_URL: supportUrl,
    },
    tags: [
      { name: 'category', value: 'event_ticket' },
      { name: 'order_id', value: payload.orderId },
    ],
  });
}

function paymentMethodLabel(method: string): string {
  const normalized = method.trim().toUpperCase();
  if (normalized === 'PIX') return 'Pix';
  if (normalized === 'CREDIT_CARD') return 'Cartão de crédito';
  if (normalized === 'BOLETO') return 'Boleto';
  return method;
}

async function sendEventPublicOrderCreatedEmail(payload: EventPublicOrderCreatedEmailPayload) {
  const statusUrl = buildAppUrl(payload.statusPath);
  const eventName = escapeHtml(payload.eventName);
  const buyerName = escapeHtml(payload.buyerName);
  const eventDate = escapeHtml(formatEventDate(payload.eventStartsAt));
  const expiresAt = escapeHtml(formatEventDate(payload.expiresAt));
  const methodLabel = escapeHtml(paymentMethodLabel(payload.paymentMethod));

  const subject = `Pedido criado — ${payload.eventName}`;
  const paymentCta = payload.invoiceUrl
    ? `<a href="${escapeHtml(payload.invoiceUrl)}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#3e1f63;color:#ffffff;text-decoration:none;font-weight:700;">Ir para o pagamento</a>`
    : '';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ee;padding:32px;color:#1f2937;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e7ddd0;border-radius:18px;padding:30px;">
        <p style="margin:0 0 10px;font-size:13px;color:#7c6f60;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">alusa eventos</p>
        <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;color:#271a10;">Reserva confirmada</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Olá, ${buyerName}. Sua reserva para <strong>${eventName}</strong> foi criada. Complete o pagamento via <strong>${methodLabel}</strong> até <strong>${expiresAt}</strong>.</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#475569;">Data do evento: <strong>${eventDate}</strong></p>
        ${paymentCta}
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b;">Guarde este link para acompanhar o pedido: <a href="${statusUrl}" style="color:#3e1f63;">status do pedido</a>.</p>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#8b8378;word-break:break-all;">Link de status:<br />${statusUrl}</p>
      </div>
    </div>
  `;

  const text = `Olá, ${payload.buyerName}.\n\nSua reserva para ${payload.eventName} foi criada. Pague via ${paymentMethodLabel(payload.paymentMethod)} até ${formatEventDate(payload.expiresAt)}.\n\nAcompanhe: ${statusUrl}${payload.invoiceUrl ? `\n\nPagamento: ${payload.invoiceUrl}` : ''}`;

  return sendResendEmail({
    to: payload.buyerEmail,
    subject,
    html,
    text,
    idempotencyKey: `event-order-created-email:${payload.orderId}`,
    tags: [
      { name: 'category', value: 'event_order_created' },
      { name: 'order_id', value: payload.orderId },
    ],
  });
}

export async function enqueueFinanceSideEffect(
  params: EnqueueFinanceSideEffectParams,
): Promise<{ enqueued: boolean; skipped: boolean }> {
  try {
    await prisma.financeWebhookSideEffectOutbox.create({
      data: {
        contaId: params.contaId,
        effectType: params.effectType,
        dedupeKey: params.dedupeKey,
        payload: params.payload,
        status: FinanceWebhookSideEffectStatus.PENDING,
      },
    });
    return { enqueued: true, skipped: false };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { enqueued: false, skipped: true };
    }
    throw error;
  }
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

    const result = await enqueueFinanceSideEffect({
      contaId: params.contaId,
      effectType: 'BILLING_NOTIFICATION',
      dedupeKey,
      payload: {
        candidate,
        sourceType: params.sourceType,
        webhookBatchId: params.webhookBatchId ?? null,
      },
    });

    if (result.enqueued) {
      enqueued += 1;
    } else if (result.skipped) {
      skipped += 1;
    }
  }

  return { enqueued, skipped };
}

export interface ReconcileBillingNotificationSideEffectsParams {
  contaId?: string;
  lookbackHours?: number;
  limit?: number;
}

export interface ReconcileBillingNotificationSideEffectsResult {
  scanned: number;
  eligible: number;
  enqueued: number;
  skipped: number;
}

/**
 * Reconstitui o efeito de notificação a partir do inbox já processado.
 *
 * O processamento do webhook e a gravação no outbox são commits distintos.
 * Se o segundo falhar depois que o primeiro foi confirmado, esta rotina
 * recompõe o efeito de forma idempotente pela chave tenant + evento + cobrança.
 * Ela não reprocessa o webhook nem altera estado financeiro.
 */
export async function reconcileMissingBillingNotificationSideEffects(
  params: ReconcileBillingNotificationSideEffectsParams = {},
): Promise<ReconcileBillingNotificationSideEffectsResult> {
  const lookbackHours = Math.min(168, Math.max(1, params.lookbackHours ?? 48));
  const limit = Math.min(1000, Math.max(1, params.limit ?? 500));
  const receivedAfter = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const webhooks = await prisma.webhookAsaas.findMany({
    where: {
      status: 'PROCESSADO',
      sideEffectsReconciledAt: null,
      recebidoEm: { gte: receivedAfter },
      asaasPaymentId: { not: null },
      ...(params.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { recebidoEm: 'desc' },
    take: limit,
    select: {
      id: true,
      contaId: true,
      evento: true,
      eventId: true,
      asaasPaymentId: true,
      recebidoEm: true,
    },
  });

  let eligible = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const webhook of webhooks) {
    if (!webhook.asaasPaymentId || !normalizeBillingNotificationEvent(webhook.evento)) {
      continue;
    }

    eligible += 1;
    const result = await enqueueBillingNotificationSideEffects({
      contaId: webhook.contaId,
      sourceType: 'ASAAS_WEBHOOK',
      webhookBatchId: 'processed-webhook-reconciliation',
      candidates: [{
        contaId: webhook.contaId,
        event: webhook.evento,
        eventId: webhook.eventId,
        asaasPaymentId: webhook.asaasPaymentId,
        occurredAt: webhook.recebidoEm,
      }],
    });
    enqueued += result.enqueued;
    skipped += result.skipped;

    await prisma.webhookAsaas.updateMany({
      where: {
        id: webhook.id,
        status: 'PROCESSADO',
        sideEffectsReconciledAt: null,
      },
      data: { sideEffectsReconciledAt: new Date() },
    });
  }

  return { scanned: webhooks.length, eligible, enqueued, skipped };
}

/** Promove registros legados FAILED que já consumiram todas as tentativas. */
export async function markExhaustedFinanceWebhookSideEffects(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ marked: number }> {
  const limit = Math.min(500, Math.max(1, params?.limit ?? 200));
  const candidates = await prisma.financeWebhookSideEffectOutbox.findMany({
    where: {
      status: FinanceWebhookSideEffectStatus.FAILED,
      attempts: { gte: MAX_ATTEMPTS },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  if (!candidates.length) return { marked: 0 };

  const result = await prisma.financeWebhookSideEffectOutbox.updateMany({
    where: {
      id: { in: candidates.map((candidate) => candidate.id) },
      status: FinanceWebhookSideEffectStatus.FAILED,
      attempts: { gte: MAX_ATTEMPTS },
    },
    data: { status: FinanceWebhookSideEffectStatus.EXHAUSTED },
  });

  if (result.count > 0) {
    console.error('[finance-side-effect-outbox] Efeitos legados movidos para EXHAUSTED', {
      count: result.count,
      contaId: params?.contaId ?? null,
    });
  }

  return { marked: result.count };
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

  if (
    event.status === FinanceWebhookSideEffectStatus.EXHAUSTED ||
    (event.status === FinanceWebhookSideEffectStatus.FAILED && event.attempts >= MAX_ATTEMPTS)
  ) {
    return { processed: false, reason: 'exhausted' };
  }

  const now = new Date();
  const lockToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + SIDE_EFFECT_LEASE_MS);
  const claimed = await prisma.financeWebhookSideEffectOutbox.updateMany({
    where: {
      id: eventId,
      OR: [
        {
          status: FinanceWebhookSideEffectStatus.PENDING,
          availableAt: { lte: now },
        },
        {
          status: FinanceWebhookSideEffectStatus.PROCESSING,
          OR: [
            { leaseExpiresAt: { lte: now } },
            { leaseExpiresAt: null },
          ],
        },
      ],
    },
    data: {
      status: FinanceWebhookSideEffectStatus.PROCESSING,
      lockedAt: now,
      leaseExpiresAt,
      lockToken,
      lastAttemptAt: now,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return { processed: false, reason: 'not_claimed' };
  }

  let providerMessageId: string | null = null;
  const isEmailEffect =
    event.effectType === 'EVENT_PUBLIC_ORDER_TICKET_EMAIL' ||
    event.effectType === 'EVENT_PUBLIC_ORDER_CREATED_EMAIL';

  try {
    if (event.effectType === 'BILLING_NOTIFICATION') {
      const payload = event.payload as {
        candidate: BillingNotificationCandidate;
        sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
      };
      await emitBillingNotifications([payload.candidate], payload.sourceType, { throwOnError: true });
    } else if (event.effectType === 'EVENT_PUBLIC_ORDER_TICKET_EMAIL') {
      providerMessageId = (await sendEventPublicOrderTicketEmail(
        event.payload as EventPublicOrderTicketEmailPayload,
      )).id;
    } else if (event.effectType === 'EVENT_PUBLIC_ORDER_CREATED_EMAIL') {
      providerMessageId = (await sendEventPublicOrderCreatedEmail(
        event.payload as EventPublicOrderCreatedEmailPayload,
      )).id;
    }

    const completed = await prisma.financeWebhookSideEffectOutbox.updateMany({
      where: {
        id: eventId,
        status: FinanceWebhookSideEffectStatus.PROCESSING,
        lockToken,
      },
      data: {
        status: FinanceWebhookSideEffectStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        lockToken: null,
        lastError: null,
        ...(isEmailEffect
          ? {
              providerMessageId,
              deliveryStatus: 'SENT',
              deliveryStatusAt: new Date(),
            }
          : {}),
      },
    });

    if (completed.count === 0) {
      return { processed: false, reason: 'lease_lost' };
    }

    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = event.attempts + 1;
    const retryable = error instanceof SideEffectDeliveryError ? error.retryable : true;
    const exhausted = !retryable || attempts >= MAX_ATTEMPTS;
    const retryDelayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1)),
    );

    const failed = await prisma.financeWebhookSideEffectOutbox.updateMany({
      where: {
        id: eventId,
        status: FinanceWebhookSideEffectStatus.PROCESSING,
        lockToken,
      },
      data: {
        status: exhausted
          ? FinanceWebhookSideEffectStatus.EXHAUSTED
          : FinanceWebhookSideEffectStatus.PENDING,
        lockedAt: null,
        leaseExpiresAt: null,
        lockToken: null,
        lastError: message,
        availableAt: exhausted ? event.availableAt : new Date(Date.now() + retryDelayMs),
        ...(isEmailEffect
          ? {
              deliveryStatus: 'FAILED',
              deliveryStatusAt: new Date(),
            }
          : {}),
      },
    });

    if (failed.count === 0) {
      return { processed: false, reason: 'lease_lost' };
    }

    if (exhausted) {
      console.error('[finance-side-effect-outbox] Efeito exaurido; requer observabilidade/reprocessamento', {
        eventId,
        effectType: event.effectType,
        contaId: event.contaId,
        attempts,
        message,
      });
    }

    return { processed: false, reason: message };
  }
}

export async function drainFinanceWebhookSideEffectOutbox(params?: {
  contaId?: string;
  limit?: number;
  effectTypes?: FinanceSideEffectType[];
}): Promise<{ attempted: number; processed: number; failed: number }> {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));

  await markExhaustedFinanceWebhookSideEffects({
    contaId: params?.contaId,
    limit,
  });

  const events = await prisma.financeWebhookSideEffectOutbox.findMany({
    where: {
      OR: [
        {
          status: FinanceWebhookSideEffectStatus.PENDING,
          availableAt: { lte: new Date() },
        },
        {
          status: FinanceWebhookSideEffectStatus.PROCESSING,
          OR: [
            { leaseExpiresAt: { lte: new Date() } },
            { leaseExpiresAt: null },
          ],
        },
      ],
      ...(params?.contaId ? { contaId: params.contaId } : {}),
      ...(params?.effectTypes?.length ? { effectType: { in: params.effectTypes } } : {}),
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
