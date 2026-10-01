import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import {
  enqueueAsaasWebhookEvent,
  handleAsaasWebhookEvent,
  inspectWebhookProcessingRuntimeStatus,
  processAsaasWebhookQueueWithInbox,
  resolveAsaasWebhookAccessToken,
  extractClientIps,
  shouldBlockAsaasWebhookByIp,
  globalWebhookRateLimiter,
  buildWebhookRateLimitKey,
  getAsaasWebhookTokenHashPrefix,
  isWebhookRateLimitFailClosedEnabled,
  parseAsaasWebhookPayload,
} from '@alusa/finance';
import type { AsaasWebhookPayload } from '@alusa/finance';
import { emitBillingNotificationCandidate } from '@/lib/notifications/emit-billing-notifications';
import { invalidateChargesCache } from '@/lib/cache/invalidation';
import { logApiOperationalEvent, recordApiResponseMetrics } from '@/lib/observability/api-logger';

const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith('application/json');
}

function resolveRequestId(headers: Headers): string {
  const candidate = headers.get('x-request-id')?.trim();
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function jsonWithRequestId(
  body: unknown,
  requestId: string,
  init: ResponseInit,
  startedAt: number,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('x-request-id', requestId);
  recordApiResponseMetrics({
    route: '/api/webhooks/asaas',
    method: 'POST',
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

function isStrictHttpRejectionsEnabled(): boolean {
  const configured = process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function resolveWebhookResponseStatus(result: { status?: number; persisted?: boolean }): number {
  if (result.persisted) return 200;

  const resultStatus = result.status;
  if (typeof resultStatus === 'number' && resultStatus >= 500) return resultStatus;
  if (!isStrictHttpRejectionsEnabled()) return 200;
  if (resultStatus === 400 || resultStatus === 401 || resultStatus === 403) return resultStatus;
  return 200;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = resolveRequestId(req.headers);

  try {
    // A allowlist de IP só bloqueia com strict mode; o authToken continua sendo
    // a barreira primária, pois proxies/serverless podem alterar o IP encaminhado.
    const clientIps = extractClientIps(req.headers);
    const clientIp = clientIps[0] ?? null;
    const accessToken = resolveAsaasWebhookAccessToken(req.headers);
    const tokenHashPrefix = getAsaasWebhookTokenHashPrefix(accessToken);

    if (shouldBlockAsaasWebhookByIp(clientIps.length > 0 ? clientIps : null)) {
      return jsonWithRequestId(
        { success: false, error: 'FORBIDDEN' },
        requestId,
        { status: 403 },
        startedAt,
      );
    }

    // Rate limiting por IP
    const rateLimitKey = buildWebhookRateLimitKey({ ip: clientIp, tokenHashPrefix });
    const rateCheck = await globalWebhookRateLimiter.checkAsync(rateLimitKey);
    if (rateCheck.degraded) {
      const failClosed = isWebhookRateLimitFailClosedEnabled();
      if (failClosed) {
        return jsonWithRequestId(
          { success: false, error: 'RATE_LIMIT_UNAVAILABLE', message: 'Proteção distribuída temporariamente indisponível.' },
          requestId,
          {
            status: 503,
            headers: { 'Retry-After': String(Math.max(1, Math.ceil(rateCheck.resetMs / 1000))) },
          },
          startedAt,
        );
      }
    }
    if (!rateCheck.allowed) {
      return jsonWithRequestId(
        { success: false, error: 'RATE_LIMITED' },
        requestId,
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) } },
        startedAt,
      );
    }

    if (!isJsonContentType(req.headers.get('content-type'))) {
      return jsonWithRequestId(
        { success: false, error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type deve ser application/json' },
        requestId,
        { status: 415 },
        startedAt,
      );
    }

    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonWithRequestId(
        { success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Payload excede o tamanho máximo permitido.' },
        requestId,
        { status: 413 },
        startedAt,
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonWithRequestId(
        { success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Payload excede o tamanho máximo permitido.' },
        requestId,
        { status: 413 },
        startedAt,
      );
    }

    // Em produção, modo assíncrono é obrigatório (a menos que FIN_WEBHOOK_SYNC_OVERRIDE=true).
    // Em dev/staging, respeita FIN_WEBHOOK_ASYNC_ENABLED.
    const processingRuntime = inspectWebhookProcessingRuntimeStatus();
    const useAsyncQueue = processingRuntime.useAsyncQueue;
    const parsedPayload = parseAsaasWebhookPayload(rawBody);
    const correlationId = parsedPayload.success && parsedPayload.payload.id
      ? `asaas-event:${parsedPayload.payload.id}`
      : randomUUID();
    let result: Awaited<ReturnType<typeof handleAsaasWebhookEvent>>;
    let processedContaId: string | null = null;

    if (useAsyncQueue) {
      const queued = await Sentry.startSpan(
        { name: 'finance.webhook.enqueue', op: 'queue.submit', attributes: { 'messaging.system': 'asaas-webhook' } },
        () => enqueueAsaasWebhookEvent({ rawBody, accessToken, correlationId }),
      );
      result = queued;
      processedContaId = queued.success ? queued.contaId ?? null : null;

      // Em produção, inline drain desabilitado por padrão (worker externo processa a fila).
      // Em dev, habilitado por padrão para facilitar testes locais.
      const shouldInlineDrain = processingRuntime.inlineDrain;
      if (shouldInlineDrain && queued.success && queued.contaId) {
        try {
          await Sentry.startSpan(
            { name: 'finance.webhook.inline_drain', op: 'queue.process', attributes: { 'messaging.system': 'asaas-webhook' } },
            () => processAsaasWebhookQueueWithInbox({
              contaId: queued.contaId,
              limit: 5,
              statuses: ['PENDENTE', 'ERRO'],
              source: 'WEBHOOK',
              drainSideEffects: false,
            }),
          );
        } catch (drainError) {
          logApiOperationalEvent({
            severity: 'warn',
            eventName: 'api.webhook.inline_drain.failed',
            route: '/api/webhooks/asaas',
            method: 'POST',
            requestId,
            error: drainError,
          });
        }
      }
    } else {
      result = await Sentry.startSpan(
        { name: 'finance.webhook.process_sync', op: 'webhook.process', attributes: { 'messaging.system': 'asaas-webhook' } },
        () => handleAsaasWebhookEvent({ rawBody, accessToken, correlationId }),
      );
      processedContaId = (result as { contaId?: string | null }).contaId ?? null;

      const payload: AsaasWebhookPayload | null = parsedPayload.success ? parsedPayload.payload : null;
      const notificationContaId = processedContaId ?? result.contaId ?? null;
      if (result.success && notificationContaId && payload?.payment?.id) {
        try {
          await emitBillingNotificationCandidate(
            {
              contaId: notificationContaId,
              event: payload.event,
              eventId: payload.id ?? null,
              asaasPaymentId: payload.payment.id,
              occurredAt:
                payload.payment.clientPaymentDate
                ?? payload.payment.paymentDate
                ?? payload.payment.creditDate
                ?? null,
            },
            'ASAAS_WEBHOOK',
          );
        } catch (notificationError) {
          logApiOperationalEvent({
            severity: 'warn',
            eventName: 'api.webhook.notification_candidate.failed',
            route: '/api/webhooks/asaas',
            method: 'POST',
            requestId,
            error: notificationError,
          });
        }
      }

    }
    if (result.success && processedContaId) {
      void invalidateChargesCache(processedContaId, 'asaas-webhook').catch((cacheError) => {
        logApiOperationalEvent({
          severity: 'warn',
          eventName: 'api.webhook.cache_invalidation.failed',
          route: '/api/webhooks/asaas',
          method: 'POST',
          requestId,
          error: cacheError,
        });
      });
    }
    // Depois de persistido, falhas de processamento viram retry/DLQ interno.
    // Antes da persistência, falhas técnicas precisam retornar 5xx para o Asaas reenviar.
    return jsonWithRequestId(
      {
        success: result.success,
        message: result.message,
        error: result.error,
        persisted: result.persisted,
        mode: useAsyncQueue ? 'QUEUE' : 'SYNC',
      },
      requestId,
      { status: resolveWebhookResponseStatus(result) },
      startedAt,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET')) {
      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.webhook.request.failed',
        route: '/api/webhooks/asaas',
        method: 'POST',
        requestId,
        error,
      });
      return jsonWithRequestId(
        {
          success: false,
          error: 'ENV_NOT_CONFIGURED',
          message: error.message,
        },
        requestId,
        { status: 503 },
        startedAt,
      );
    }

    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.webhook.request.failed',
      route: '/api/webhooks/asaas',
      method: 'POST',
      requestId,
      error,
    });
    return jsonWithRequestId(
      {
        success: false,
        error: 'ERRO_INTERNO',
      },
      requestId,
      { status: 500 },
      startedAt,
    );
  }
}
