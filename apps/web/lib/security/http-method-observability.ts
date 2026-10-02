import { NextResponse } from 'next/server';
import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

const jobPaths = [
  'apply-asaas-notification-preferences',
  'archive-finance-webhooks',
  'archive-low-value-notifications',
  'asaas-health-check',
  'auto-close-agenda-events',
  'encerrar-contratos',
  'evaluate-financial-operational-health',
  'events-expire-reservations',
  'events-fulfill-tickets',
  'events-inspect-financial-inconsistencies',
  'events-reconcile-orders',
  'expire-contract-links',
  'matriculas/close-expired',
  'notify-contracts-expiring',
  'platform-billing-maintenance',
  'process-billing-agreement-lifecycle',
  'process-finance-webhooks',
  'process-overdue-billing-notifications',
  'process-pending-inbox-notifications',
  'provision-asaas-subaccounts',
  'rebuild-billing-read-models',
  'rebuild-finance-aggregates',
  'reconcile-asaas-customers',
  'reconcile-finance-accounts',
  'reconcile-finance-webhooks',
  'reconcile-fiscal-settings',
  'reconcile-kyc-models',
  'reconcile-matricula-cancellations',
  'reconcile-open-transfers',
  'reconcile-payment-commands',
  'reconcile-portal-finance',
  'reconcile-stale-invoices',
  'rematriculas/activate',
  'rematriculas/integrity',
  'rematriculas/outbox',
  'rematriculas/provision-finance',
  'rematriculas/run',
  'retry-enrollment-billing-provision',
  'webhook-maintenance',
  'webhook-scheduler',
  'whatsapp',
] as const;

const postOnlyJobs = new Set([
  'auto-close-agenda-events',
  'rematriculas/provision-finance',
]);

const knownMethodOverrides = new Map<string, readonly ApiMethod[]>([
  ['/api/webhooks/asaas', ['POST']],
  ['/api/webhooks/asaas/transfers/authorize', ['POST']],
  ['/api/webhooks/stripe', ['POST']],
  ['/api/webhooks/whatsapp', ['GET', 'POST']],
]);

export function getKnownApiMethods(pathname: string): readonly ApiMethod[] | null {
  const override = knownMethodOverrides.get(pathname);
  if (override) return override;

  if (pathname.startsWith('/api/comunicacao/whatsapp/')) {
    if (pathname.startsWith('/api/comunicacao/whatsapp/contratos/') && pathname.endsWith('/template')) {
      return ['GET', 'POST'];
    }
    return ['POST'];
  }

  if (pathname.startsWith('/api/jobs/')) {
    const jobPath = pathname.slice('/api/jobs/'.length);
    if (!jobPaths.includes(jobPath as (typeof jobPaths)[number])) return null;
    return postOnlyJobs.has(jobPath) ? ['POST'] : ['GET', 'POST'];
  }

  return null;
}

export function isKnownApiMethodAllowed(method: string, allowedMethods: readonly ApiMethod[]): boolean {
  const normalized = method.toUpperCase();
  if (normalized === 'OPTIONS') return true;
  if (normalized === 'HEAD') return allowedMethods.includes('GET');
  return allowedMethods.includes(normalized as ApiMethod);
}

export function logMethodNotAllowed(
  _request: Request,
  _allowedMethods: readonly ApiMethod[],
  _reason: string,
): void {
  logRuntimeOperationalEvent({ eventName: 'security.http_method.rejected', category: 'invalid_method', severity: 'warn' });
}

export function methodNotAllowedResponse(
  request: Request,
  allowedMethods: readonly ApiMethod[],
  reason: string,
): NextResponse {
  logMethodNotAllowed(request, allowedMethods, reason);
  const allow = new Set<ApiMethod>(['OPTIONS', ...allowedMethods]);
  if (allowedMethods.includes('GET')) allow.add('HEAD');
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP não suportado.' } },
    { status: 405, headers: { Allow: [...allow].sort().join(', '), 'cache-control': 'no-store' } },
  );
}
