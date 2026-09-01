import { NextResponse } from 'next/server';
import { processAsaasNotificationSyncOutbox } from '@alusa/finance';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

/**
 * GET/POST /api/jobs/process-asaas-notification-sync
 *
 * Reprocessa apenas sincronizações explícitas de canais enfileiradas pelo
 * fluxo de cobrança. Não cria, cancela ou altera pagamentos.
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await processAsaasNotificationSyncOutbox({
      contaId: tenantScope.contaId,
      limit: clampPositiveInt(url.searchParams.get('limit'), 25, 100),
      maxAttempts: clampPositiveInt(url.searchParams.get('maxAttempts'), 8, 20),
    });

    return NextResponse.json({ success: result.failed === 0, result });
  } catch (error) {
    console.error('[Job Process Asaas Notification Sync] Erro:', error);
    return NextResponse.json(
      { error: { code: 'ERRO_JOB', message: 'Não foi possível processar a fila de notificações.' } },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
