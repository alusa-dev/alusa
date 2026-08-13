import { NextResponse } from 'next/server';
import { archiveLowValueNotifications } from '@alusa/lib';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clamp(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

/**
 * POST /api/jobs/archive-low-value-notifications
 *
 * Arquiva, em lotes pequenos, eventos antigos que não fazem parte da inbox
 * operacional atual. O histórico de auditoria permanece preservado.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) return tenantScope.response;

    const result = await archiveLowValueNotifications({
      contaId: tenantScope.contaId,
      olderThanDays: clamp(url.searchParams.get('olderThanDays'), 30, 3650),
      limit: clamp(url.searchParams.get('limit'), 500, 5000),
    });

    return NextResponse.json({
      success: true,
      ...result,
      cutoff: result.cutoff.toISOString(),
    });
  } catch (error) {
    console.error('[Job Archive Low Value Notifications] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : 'Erro desconhecido');
  }
}

export async function GET() {
  return NextResponse.json({
    job: 'archive-low-value-notifications',
    description: 'Arquiva notificações antigas que não pertencem à inbox operacional.',
    method: 'POST',
    params: {
      contaId: 'opcional; sem conta, o cron processa todos os tenants',
      olderThanDays: 'opcional; padrão 30, máximo 3650',
      limit: 'opcional; padrão 500, máximo 5000',
    },
  });
}
