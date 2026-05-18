import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { notifyContractsExpiring } from '@alusa/lib';
import { prisma } from '@/src/prisma';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/notify-contracts-expiring
 *
 * Alerta contratos que vencem em 7, 3 ou 1 dia(s).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireContaIdForCron: false,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    if (tenantScope.contaId) {
      const result = await notifyContractsExpiring(tenantScope.contaId);
      return NextResponse.json({ success: true, tenants: 1, ...result });
    }

    const contas = await prisma.conta.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 500,
    });

    let evaluated = 0;
    let notified = 0;
    for (const conta of contas) {
      const result = await notifyContractsExpiring(conta.id);
      evaluated += result.evaluated;
      notified += result.notified;
    }

    return NextResponse.json({
      success: true,
      tenants: contas.length,
      evaluated,
      notified,
    });
  } catch (error) {
    console.error('[Job Notify Contracts Expiring] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}
