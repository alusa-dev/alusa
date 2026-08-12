import { NextResponse } from 'next/server';
import { z } from 'zod';

import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { lookupExternalPixKey } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string; financeIntegrationMode?: string | null };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const requestSchema = z.object({
  type: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']),
  key: z.string().trim().min(1).max(320),
}).strict();
const errorStatus: Record<string, number> = {
  CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: 503,
  CHAVE_PIX_NAO_ENCONTRADA: 400,
  CONSULTA_CHAVE_PIX_INDISPONIVEL: 503,
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessionUser } | null)?.user;
    if (!user?.id || !user.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(user.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;
    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json(400, { error: 'VALIDATION_ERROR', details: parsed.error.flatten() });

    const result = await lookupExternalPixKey({ contaId: user.contaId, ...parsed.data });
    if (!result.success) return json(errorStatus[result.error] ?? 500, { error: result.error });
    return json(200, { data: result.data });
  } catch (error) {
    console.error('[Finance transfer pix-key][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
