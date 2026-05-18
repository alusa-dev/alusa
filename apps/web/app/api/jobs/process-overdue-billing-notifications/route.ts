import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processLocalOverdueBillingNotifications } from '@alusa/lib';
import { prisma } from '@/src/prisma';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/process-overdue-billing-notifications
 *
 * Emite notificações de cobrança vencida (fallback local ao webhook PAYMENT_OVERDUE).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const limitRaw = Number(url.searchParams.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

    if (tenantScope.contaId) {
      const result = await processLocalOverdueBillingNotifications({
        contaId: tenantScope.contaId,
        limit,
      });
      return NextResponse.json({ success: true, tenants: 1, ...result });
    }

    const contas = await prisma.conta.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 500,
    });

    let emitted = 0;
    let skipped = 0;
    for (const conta of contas) {
      const result = await processLocalOverdueBillingNotifications({
        contaId: conta.id,
        limit,
      });
      emitted += result.emitted;
      skipped += result.skipped;
    }

    return NextResponse.json({
      success: true,
      tenants: contas.length,
      emitted,
      skipped,
    });
  } catch (error) {
    console.error('[Job Process Overdue Billing] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}
