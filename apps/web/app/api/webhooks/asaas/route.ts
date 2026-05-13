import { NextRequest, NextResponse } from 'next/server';
import {
  enqueueAsaasWebhookEvent,
  handleAsaasWebhookEvent,
  inspectWebhookProcessingRuntimeStatus,
  processAsaasWebhookQueue,
  resolveAsaasWebhookAccessToken,
  extractClientIps,
  isAsaasWebhookIpAllowed,
  shouldBlockAsaasWebhookByIp,
  globalWebhookRateLimiter,
  buildWebhookRateLimitKey,
  getAsaasWebhookTokenHashPrefix,
  redactWebhookLogObject,
} from '@alusa/finance';
import type { AsaasWebhookPayload } from '@alusa/asaas-gateway';
import { emitBillingNotificationCandidate, emitBillingNotifications } from '@/lib/notifications/emit-billing-notifications';

const MAX_BODY_BYTES = 512 * 1024;

function parseWebhookPayload(rawBody: string): AsaasWebhookPayload | null {
  try {
    return JSON.parse(rawBody) as AsaasWebhookPayload;
  } catch {
    return null;
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith('application/json');
}

function isStrictHttpRejectionsEnabled(): boolean {
  return process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS === 'true';
}

function resolveWebhookResponseStatus(resultStatus: number | undefined): number {
  if (!isStrictHttpRejectionsEnabled()) return 200;
  if (resultStatus === 400 || resultStatus === 401 || resultStatus === 403) return resultStatus;
  return 200;
}

export async function POST(req: NextRequest) {
  try {
    // IP allowlist é diagnóstica por padrão. O authToken do webhook é a
    // barreira primária; bloquear por IP em serverless pode pausar filas se
    // o sandbox usar IP adicional ou a CDN alterar X-Forwarded-For.
    const clientIps = extractClientIps(req.headers);
    const clientIp = clientIps[0] ?? null;
    const accessToken = resolveAsaasWebhookAccessToken(req.headers);
    const tokenHashPrefix = getAsaasWebhookTokenHashPrefix(accessToken);
    const ipAllowed = isAsaasWebhookIpAllowed(clientIps.length > 0 ? clientIps : null);
    if (!ipAllowed) {
      console.warn('[Asaas Webhook] IP fora da allowlist diagnóstica', redactWebhookLogObject({
        clientIp,
        candidateCount: clientIps.length,
        strict: process.env.ASAAS_WEBHOOK_IP_CHECK === 'strict',
      }));
    }

    if (shouldBlockAsaasWebhookByIp(clientIps.length > 0 ? clientIps : null)) {
      return NextResponse.json(
        { success: false, error: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // Rate limiting por IP
    const rateLimitKey = buildWebhookRateLimitKey({ ip: clientIp, tokenHashPrefix });
    const rateCheck = globalWebhookRateLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
      console.warn('[Asaas Webhook] Rate limit aplicado', redactWebhookLogObject({
        clientIp,
        tokenHashPrefix,
        scoped: process.env.ASAAS_WEBHOOK_AUTH_SCOPED_RATE_LIMIT === 'true',
      }));
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) } },
      );
    }

    if (!isJsonContentType(req.headers.get('content-type'))) {
      return NextResponse.json(
        { success: false, error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type deve ser application/json' },
        { status: 415 },
      );
    }

    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Payload excede o tamanho máximo permitido.' },
        { status: 413 },
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Payload excede o tamanho máximo permitido.' },
        { status: 413 },
      );
    }

    // Em produção, modo assíncrono é obrigatório (a menos que FIN_WEBHOOK_SYNC_OVERRIDE=true).
    // Em dev/staging, respeita FIN_WEBHOOK_ASYNC_ENABLED.
    const processingRuntime = inspectWebhookProcessingRuntimeStatus();
    const useAsyncQueue = processingRuntime.useAsyncQueue;
    let result: Awaited<ReturnType<typeof handleAsaasWebhookEvent>>;

    if (useAsyncQueue) {
      const queued = await enqueueAsaasWebhookEvent({ rawBody, accessToken });
      result = queued;

      // Em produção, inline drain desabilitado por padrão (worker externo processa a fila).
      // Em dev, habilitado por padrão para facilitar testes locais.
      const shouldInlineDrain = processingRuntime.inlineDrain;
      if (shouldInlineDrain && queued.success && queued.contaId) {
        try {
          const drainResult = await processAsaasWebhookQueue({
            contaId: queued.contaId,
            limit: 5,
            statuses: ['PENDENTE', 'ERRO'],
            source: 'WEBHOOK',
          });
          await emitBillingNotifications(drainResult.processedPayments, 'ASAAS_WEBHOOK');
        } catch (drainError) {
          console.warn('[Asaas Webhook][inline-drain] Falha no processamento imediato da fila', redactWebhookLogObject({
            contaId: queued.contaId,
            error: drainError instanceof Error ? drainError.message : String(drainError),
          }));
        }
      }
    } else {
      result = await handleAsaasWebhookEvent({ rawBody, accessToken });

      const payload = parseWebhookPayload(rawBody);
      if (result.success && payload?.payment?.id) {
        try {
          await emitBillingNotificationCandidate(
            {
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
          console.warn('[Asaas Webhook][notification-candidate] Falha ao emitir notificação', redactWebhookLogObject({
            asaasPaymentId: payload.payment.id,
            event: payload.event,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
          }));
        }
      }
    }
    // Sempre retornar 200 após processamento.
    // Erros de lógica ficam em WebhookAsaas.status='ERRO' com reprocessamento interno.
    // Retornar 5xx faria o Asaas reenviar indefinidamente para erros permanentes.
    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        error: result.error,
        mode: useAsyncQueue ? 'QUEUE' : 'SYNC',
      },
      { status: resolveWebhookResponseStatus(result.status) },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET')) {
      return NextResponse.json(
        {
          success: false,
          error: 'ENV_NOT_CONFIGURED',
          message: error.message,
        },
        { status: 200 },
      );
    }

    console.error('[Asaas Webhook][POST]', redactWebhookLogObject({
      error: error instanceof Error ? error : String(error),
    }));
    // 200 para evitar retries do Asaas — erros persistem no banco para reprocessamento
    return NextResponse.json(
      {
        success: false,
        error: 'ERRO_INTERNO',
      },
      { status: 200 },
    );
  }
}
