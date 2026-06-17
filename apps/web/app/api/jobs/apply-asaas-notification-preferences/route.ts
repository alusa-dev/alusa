import { NextResponse } from 'next/server';
import {
  enqueueAsaasNotificationPreferenceSyncForTenant,
  processAsaasNotificationPreferenceOutbox,
} from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

/**
 * GET/POST /api/jobs/apply-asaas-notification-preferences
 *
 * Drena a outbox de preferências Asaas. Opcionalmente enfileira primeiro para uma conta.
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const limit = clampPositiveInt(url.searchParams.get('limit'), 50, 200);
    const enqueue = url.searchParams.get('enqueue') === 'true';
    const enqueueLimit = clampPositiveInt(url.searchParams.get('enqueueLimit'), 500, 5_000);
    let enqueued = 0;

    if (enqueue && tenantScope.contaId) {
      const enqueueResult = await enqueueAsaasNotificationPreferenceSyncForTenant({
        contaId: tenantScope.contaId,
        reason: 'JOB_ENQUEUE_REQUEST',
        limit: enqueueLimit,
      });
      enqueued = enqueueResult.enqueued;
    }

    const result = await processAsaasNotificationPreferenceOutbox({
      contaId: tenantScope.contaId,
      limit,
    });

    return NextResponse.json({
      success: result.failed === 0,
      enqueued,
      result,
    });
  } catch (error) {
    console.error('[Job Apply Asaas Notification Preferences] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
