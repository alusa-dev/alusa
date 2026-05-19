import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { cancelTransfer } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string; financeIntegrationMode?: string | null };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ transferId: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(user.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const transferId = ctxParams.transferId;
    if (!transferId) return json(400, { error: 'TRANSFER_ID_OBRIGATORIO' });

    const result = await cancelTransfer({
      contaId: user.contaId,
      transferId,
      actor: { type: 'USER', id: user.id },
    });

    if (!result.success) {
      const status =
        result.error === 'TRANSFER_NAO_ENCONTRADA'
          ? 404
          : result.error === 'TRANSFER_SEM_ID_ASAAS' || result.error === 'TRANSFER_NAO_CANCELAVEL'
            ? 409
            : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
              ? 503
              : 500;

      return json(status, { error: result.error });
    }

    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Finance Transfers Cancel][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;