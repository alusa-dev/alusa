import { NextResponse } from 'next/server';

import { safeGetServerSession } from '@/lib/safe-server-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { deleteTransferRecipient, listTransferRecipients } from '@alusa/finance';

type SessUser = { id?: string; contaId?: string; role?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const result = await listTransferRecipients({ contaId: user.contaId, limit: 8 });
    return json(200, { data: result });
  } catch (error) {
    console.error('[Finance transfer recipients][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const body = (await request.json().catch(() => null)) as { recipientId?: string } | null;
    const recipientId = body?.recipientId?.trim();

    if (!recipientId) {
      return json(400, { error: 'RECIPIENT_ID_OBRIGATORIO' });
    }

    const result = await deleteTransferRecipient({ contaId: user.contaId, recipientId });
    if (result.removedCount === 0) {
      return json(404, { error: 'DESTINATARIO_NAO_ENCONTRADO' });
    }

    return json(200, { data: result });
  } catch (error) {
    console.error('[Finance transfer recipients][DELETE]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;