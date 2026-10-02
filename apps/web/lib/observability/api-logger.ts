import {
  createStructuredLog,
  normalizeHttpMethod,
  normalizeHttpRoute,
  normalizeMetricDimensions,
  sharedTelemetry,
  statusClass,
} from '@alusa/observability';
import { shouldSampleMetric } from '@/lib/observability/sampling';

type ApiLogLevel = 'info' | 'warn' | 'error';

type ApiLogFields = {
  route: string;
  requestId: string;
  method: string;
  status?: number;
  errorCode?: string;
  tenantId?: string;
  resourceId?: string;
  durationMs?: number;
  [key: string]: unknown;
};

export type ApiOperationalEventName =
  | 'api.upload.orphan_cleanup.failed'
  | 'api.upload.presign.failed'
  | 'api.upload.pending_cleanup.failed'
  | 'api.upload.complete.failed'
  | 'api.upload.failed'
  | 'api.upload.delete.failed'
  | 'api.webhook.inline_drain.failed'
  | 'api.webhook.maintenance.failed'
  | 'api.webhook.notification_candidate.failed'
  | 'api.webhook.cache_invalidation.failed'
  | 'api.webhook.request.failed'
  | 'auth.sessions.audit_failed'
  | 'auth.sessions.revoke_failed'
  | 'auth.password_reset.delivery_failed'
  | 'auth.password_reset.request_failed'
  | 'auth.password_reset.reset_failed'
  | 'auth.nextauth.route_failed'
  | 'auth.verify_email.request_failed'
  | 'auth.verify_email.resend_failed'
  | 'conta.finance_onboarding.kyc_fallback'
  | 'conta.finance_onboarding.request_failed'
  | 'conta.payment_method.sync_failed'
  | 'conta.payment_method.read_failed'
  | 'api.users.request.failed'
  | 'api.users.request.rejected'
  | 'api.users.audit.write.failed'
  | 'api.users.invite.delivery.failed'
  | 'api.mobile_auth.request.failed'
  | 'api.mobile.request.failed'
  | 'api.notifications.request.failed'
  | 'api.notifications.cache_write.failed'
  | 'api.notifications.database_pool_timeout'
  | 'api.admin.request.failed'
  | 'api.academic.request.failed'
  | 'api.kyc.request.failed'
  | 'api.invoice_config.request.failed'
  | 'api.events.request.failed'
  | 'api.events.ticket_sale.email_outbox_drain.failed'
  | 'api.events.payment_book.failed'
  | 'api.public_event_map.notification_sync.degraded'
  | 'api.portal.request.failed'
  | 'api.portal.finance.asaas_unavailable'
  | 'api.portal.finance.asaas_read.failed'
  | 'api.platform_billing.stripe_webhook.received'
  | 'api.platform_billing.stripe_webhook.duplicate'
  | 'api.platform_billing.stripe_webhook.inline_drain.completed'
  | 'api.platform_billing.stripe_webhook.request.failed'
  | 'api.platform_billing.stripe_webhook.worker.notification_failed'
  | 'api.platform_billing.stripe_webhook.worker.retry_scheduled'
  | 'api.platform_billing.stripe_webhook.worker.exhausted'
  | 'api.platform_billing.stripe_webhook.worker.replay_requested'
  | 'api.platform_billing.checkout.created'
  | 'api.platform_billing.plan_change.upgrade_requested'
  | 'api.platform_billing.plan_change.downgrade_scheduled'
  | 'api.platform_billing.trial.created'
  | 'api.platform_billing.cancel.scheduled'
  | 'api.platform_billing.cancel.reverted'
  | 'api.platform_billing.plan_change.unique_conflict'
  | 'api.platform_billing.plan_change.cancel.unique_conflict'
  | 'api.platform_billing.plan_change.undo_cancel.unique_conflict'
  | 'api.platform_billing.plan_change.request.unique_conflict'
  | 'api.platform_billing.trial.notification_failed'
  | 'api.platform_billing.grace_period.notification_failed'
  | 'api.platform_billing.notification_email.failed'
  | 'api.platform_billing.summary.invalid_dto'
  | 'api.account.close.subscription_cancel.failed'
  | 'api.account.close.failed'
  | 'api.plans.list.failed'
  | 'api.plans.create.failed'
  | 'api.plans.update.failed'
  | 'api.plans.delete.failed'
  | 'api.classes.create.failed'
  | 'api.public_contract.read.failed'
  | 'api.public_contract.sign.failed'
  | 'api.public_contract.otp_persistence.failed'
  | 'api.public_event_contract.otp_persistence.failed'
  | 'api.asaas_notification_preferences.request.failed'
  | 'api.whatsapp_webhook.persist.failed'
  | 'api.asaas_transfer_authorization_webhook.failed'
  | 'api.account.verification_status.failed'
  | 'api.files.read.failed'
  | 'api.discounts.request.failed'
  | 'api.employees.request.failed'
  | 'api.employees.photo_upload.failed'
  | 'api.employees.photo_cleanup.failed'
  | 'api.whatsapp_test.send.failed'
  | 'api.whatsapp_contract.send.failed'
  | 'api.whatsapp_ticket.send.failed'
  | 'api.dashboard.request.failed'
  | 'api.store_sales.request.failed'
  | 'api.store_sales.product_option.request.failed'
  | 'api.store_sales.product_variants.request.failed'
  | 'api.family_renewal.request.failed'
  | 'api.test_invite.request.failed'
  | EnrollmentOperationalEventName
  | PersonDataOperationalEventName;

export type EnrollmentOperationalEventName =
  | 'api.enrollment.read.failed'
  | 'api.enrollment.update.failed'
  | 'api.enrollment.delete.failed'
  | 'api.enrollment.audit.write.failed'
  | 'api.enrollment.finance.divergence_audit.failed'
  | 'api.enrollment.capacity_alert.failed'
  | 'api.enrollment.operation.unique_conflict'
  | 'api.enrollment.billing.invalid_payload'
  | 'api.enrollment.billing.provision.failed'
  | 'api.enrollment.compensation.failed'
  | 'api.enrollment.saga.reconciliation_required'
  | 'api.enrollment.retry.completed'
  | 'api.enrollment.asaas.read.failed'
  | 'api.enrollment.asaas.sync.degraded'
  | 'api.enrollment.asaas.provision.failed'
  | 'api.enrollment.list.failed'
  | 'api.renewal.list.failed'
  | 'api.renewal.create.failed'
  | 'api.renewal.operation.unique_conflict';

const ENROLLMENT_EVENT_ROUTE: Record<EnrollmentOperationalEventName, { route: string; method: string }> = {
  'api.enrollment.read.failed': { route: '/api/matriculas/[id]', method: 'GET' },
  'api.enrollment.update.failed': { route: '/api/matriculas/[id]', method: 'PATCH' },
  'api.enrollment.delete.failed': { route: '/api/matriculas/[id]', method: 'DELETE' },
  'api.enrollment.audit.write.failed': { route: '/api/matriculas', method: 'POST' },
  'api.enrollment.finance.divergence_audit.failed': { route: '/api/matriculas', method: 'POST' },
  'api.enrollment.capacity_alert.failed': { route: '/api/rematriculas', method: 'POST' },
  'api.enrollment.operation.unique_conflict': { route: '/api/matriculas', method: 'POST' },
  'api.enrollment.billing.invalid_payload': { route: '/api/matriculas/familiar', method: 'POST' },
  'api.enrollment.billing.provision.failed': { route: '/api/matriculas/familiar', method: 'POST' },
  'api.enrollment.compensation.failed': { route: '/api/matriculas/familiar', method: 'POST' },
  'api.enrollment.saga.reconciliation_required': { route: '/api/matriculas', method: 'POST' },
  'api.enrollment.retry.completed': { route: '/api/jobs/retry-enrollment-billing', method: 'POST' },
  'api.enrollment.asaas.read.failed': { route: '/api/matriculas/[id]/reenviar-cobranca', method: 'POST' },
  'api.enrollment.asaas.sync.degraded': { route: '/api/matriculas/[id]/reenviar-cobranca', method: 'POST' },
  'api.enrollment.asaas.provision.failed': { route: '/api/matriculas/[id]/reenviar-cobranca', method: 'POST' },
  'api.enrollment.list.failed': { route: '/api/matriculas', method: 'GET' },
  'api.renewal.list.failed': { route: '/api/rematriculas', method: 'GET' },
  'api.renewal.create.failed': { route: '/api/rematriculas', method: 'POST' },
  'api.renewal.operation.unique_conflict': { route: '/api/rematriculas', method: 'POST' },
};

export function logEnrollmentOperationalEvent(
  eventName: EnrollmentOperationalEventName,
  error?: unknown,
  options: {
    severity?: 'warn' | 'error';
    itemCount?: number;
    failedCount?: number;
  } = {},
): void {
  const { route, method } = ENROLLMENT_EVENT_ROUTE[eventName];
  logApiOperationalEvent({
    severity: options.severity ?? 'error',
    eventName,
    route,
    method,
    requestId: crypto.randomUUID(),
    error,
    itemCount: options.itemCount,
    failedCount: options.failedCount,
  });
}

export type PersonDataOperationalEventName =
  | 'api.students.detail.failed'
  | 'api.students.archive.gateway_sync.failed'
  | 'api.students.archive.sync.incomplete'
  | 'api.responsibles.detail.failed'
  | 'api.responsibles.update.failed'
  | 'api.responsibles.delete.failed'
  | 'api.responsibles.overview.failed'
  | 'api.teachers.sync.degraded'
  | 'api.mobile.password_change.challenge.failed'
  | 'api.mobile.password_change.verify.failed'
  | 'api.mobile.password_change.complete.failed'
  | 'api.avatar.cleanup.failed'
  | 'api.events.participant.projection.failed'
  | 'api.events.payment_book.provider_failed'
  | 'api.billing_agreements.request.failed';

const PERSON_DATA_EVENT_ROUTE: Record<PersonDataOperationalEventName, { route: string; method: string }> = {
  'api.students.detail.failed': { route: '/api/alunos/[id]/detalhes', method: 'GET' },
  'api.students.archive.gateway_sync.failed': { route: '/api/alunos/[id]', method: 'DELETE' },
  'api.students.archive.sync.incomplete': { route: '/api/alunos/[id]', method: 'DELETE' },
  'api.responsibles.detail.failed': { route: '/api/responsaveis/[id]', method: 'GET' },
  'api.responsibles.update.failed': { route: '/api/responsaveis/[id]', method: 'PATCH' },
  'api.responsibles.delete.failed': { route: '/api/responsaveis/[id]', method: 'DELETE' },
  'api.responsibles.overview.failed': { route: '/api/responsaveis/[id]/overview', method: 'GET' },
  'api.teachers.sync.degraded': { route: '/api/professores', method: 'GET' },
  'api.mobile.password_change.challenge.failed': { route: '/api/mobile/profile/password-change/challenge', method: 'POST' },
  'api.mobile.password_change.verify.failed': { route: '/api/mobile/profile/password-change/verify', method: 'POST' },
  'api.mobile.password_change.complete.failed': { route: '/api/mobile/profile/password-change/complete', method: 'POST' },
  'api.avatar.cleanup.failed': { route: '/api/users/me/avatar', method: 'PATCH' },
  'api.events.participant.projection.failed': { route: '/api/events/[eventId]/participants/[participantId]', method: 'DELETE' },
  'api.events.payment_book.provider_failed': { route: '/api/events/[eventId]/participants/[participantId]/payment-book', method: 'GET' },
  'api.billing_agreements.request.failed': { route: '/api/billing-agreements', method: 'POST' },
};

export function logPersonDataOperationalEvent(
  eventName: PersonDataOperationalEventName,
  error?: unknown,
  severity: 'warn' | 'error' = 'error',
): void {
  const { route, method } = PERSON_DATA_EVENT_ROUTE[eventName];
  logApiOperationalEvent({
    severity,
    eventName,
    route,
    method,
    requestId: crypto.randomUUID(),
    error,
  });
}

function normalizedRequestId(suppliedRequestId: string): string {
  return /^[a-zA-Z0-9:._-]{8,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
}

export function recordApiResponseMetrics(params: {
  route: string;
  method: string;
  status: number;
  durationMs?: number;
}) {
  const dimensions = normalizeMetricDimensions({
    'http.request.method': normalizeHttpMethod(params.method),
    'http.route': normalizeHttpRoute(params.route),
    'http.response.status_class': statusClass(params.status),
  });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.http.server.requests',
    value: 1,
    dimensions,
  });
  if (
    typeof params.durationMs === 'number' &&
    Number.isFinite(params.durationMs) &&
    shouldSampleMetric(process.env.OBSERVABILITY_METRIC_SAMPLE_RATE)
  ) {
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.http.server.duration',
      value: Math.max(0, params.durationMs),
      unit: 'millisecond',
      dimensions,
    });
  }
}

function write(level: ApiLogLevel, fields: ApiLogFields) {
  const route = normalizeHttpRoute(fields.route);
  const status = fields.status;
  recordApiResponseMetrics({
    route,
    method: fields.method,
    status: status ?? 0,
    durationMs: fields.durationMs,
  });
  const eventName =
    fields.event === 'api.request.failed'
      ? 'api.request.failed'
      : fields.event === 'api.request.rejected'
        ? 'api.request.rejected'
        : 'api.request.completed';
  const requestId = normalizedRequestId(fields.requestId);
  const log = createStructuredLog({
    severity: level,
    'service.name': 'alusa-web',
    'service.version': process.env.VERCEL_GIT_COMMIT_SHA,
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': eventName,
    requestId,
    'http.request.method': normalizeHttpMethod(fields.method),
    'http.route': route,
    'http.response.status_code': fields.status,
    duration_ms: fields.durationMs,
    'error.type': typeof fields.errorName === 'string' ? fields.errorName : undefined,
    attributes: {
      ...(typeof fields.errorCode === 'string' ? { errorCode: fields.errorCode } : {}),
    },
    allowedAttributes: ['errorCode'],
  });

  if (level === 'error') {
    console.error(JSON.stringify(log));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(log));
  } else if (process.env.API_ACCESS_LOGS === '1' || process.env.NODE_ENV === 'development') {
    console.info(JSON.stringify(log));
  }
  if (level === 'warn' || level === 'error') {
    void sharedTelemetry.publishLog(log);
  }
}

export function logApiOperationalEvent(params: {
  severity: 'info' | 'warn' | 'error';
  eventName: ApiOperationalEventName;
  route: string;
  method: string;
  requestId: string;
  error?: unknown;
  itemCount?: number;
  processedCount?: number;
  failedCount?: number;
  exhaustedCount?: number;
  ignoredCount?: number;
  replayedCount?: number;
  outcome?: 'success' | 'partial_failure';
}): void {
  const attributes = {
    ...(Number.isSafeInteger(params.itemCount) && (params.itemCount ?? -1) >= 0
      ? { itemCount: params.itemCount }
      : {}),
    ...(Number.isSafeInteger(params.processedCount) && (params.processedCount ?? -1) >= 0
      ? { processedCount: params.processedCount }
      : {}),
    ...(Number.isSafeInteger(params.failedCount) && (params.failedCount ?? -1) >= 0
      ? { failedCount: params.failedCount }
      : {}),
    ...(Number.isSafeInteger(params.exhaustedCount) && (params.exhaustedCount ?? -1) >= 0
      ? { exhaustedCount: params.exhaustedCount }
      : {}),
    ...(Number.isSafeInteger(params.ignoredCount) && (params.ignoredCount ?? -1) >= 0
      ? { ignoredCount: params.ignoredCount }
      : {}),
    ...(Number.isSafeInteger(params.replayedCount) && (params.replayedCount ?? -1) >= 0
      ? { replayedCount: params.replayedCount }
      : {}),
    ...(params.outcome ? { outcome: params.outcome } : {}),
  };
  const log = createStructuredLog({
    severity: params.severity,
    'service.name': 'alusa-web',
    'service.version': process.env.VERCEL_GIT_COMMIT_SHA,
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    requestId: normalizedRequestId(params.requestId),
    'http.request.method': normalizeHttpMethod(params.method),
    'http.route': normalizeHttpRoute(params.route),
    'error.type':
      params.error instanceof Error
        ? /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(params.error.name)
          ? params.error.name
          : 'Error'
        : undefined,
    attributes,
    allowedAttributes: [
      'itemCount',
      'processedCount',
      'failedCount',
      'exhaustedCount',
      'ignoredCount',
      'replayedCount',
      'outcome',
    ],
  });

  if (params.severity === 'error') console.error(JSON.stringify(log));
  else if (params.severity === 'warn') console.warn(JSON.stringify(log));
  else console.info(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}

export function getRequestId(request: Request): string {
  const requestId = request.headers.get('x-request-id')?.trim();
  if (requestId && /^[a-zA-Z0-9._-]{8,128}$/.test(requestId)) return requestId;
  const vercelId = request.headers.get('x-vercel-id')?.trim();
  if (vercelId && /^[a-zA-Z0-9:._-]{8,128}$/.test(vercelId)) return vercelId;
  return crypto.randomUUID();
}

export function logApiResponse(params: ApiLogFields & { startedAt: number }) {
  const { startedAt, ...fields } = params;
  const status = fields.status ?? 200;
  write(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', {
    ...fields,
    status,
    durationMs: Date.now() - startedAt,
    event: status >= 400 ? 'api.request.rejected' : 'api.request.completed',
  });
}

export function logApiError(params: ApiLogFields & { startedAt: number; error?: unknown }) {
  const { startedAt, error, ...fields } = params;
  const errorName = error instanceof Error ? error.name : undefined;
  write('error', {
    ...fields,
    event: 'api.request.failed',
    durationMs: Date.now() - startedAt,
    errorName,
  });
}
