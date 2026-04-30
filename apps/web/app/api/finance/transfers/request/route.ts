import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  requestWithdraw,
  requestWithdrawDTOSchema,
  mapRequestWithdrawDTOToInput,
  mapRequestWithdrawOutputToDTO,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const idempotencyKey = req.headers.get('Idempotency-Key');
    if (!idempotencyKey) return json(400, { error: 'IDEMPOTENCY_KEY_OBRIGATORIO' });

    const raw = await req.json().catch(() => null);
    const parsed = requestWithdrawDTOSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const input = mapRequestWithdrawDTOToInput(parsed.data, {
      contaId: user.contaId,
      idempotencyKey,
      actorId: user.id,
    });

    const result = await requestWithdraw(input);

    if (!result.success) {
      const status =
        result.error === 'FEATURE_DISABLED'
          ? 403
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
            : result.error === 'SALDO_INSUFICIENTE'
              ? 400
              : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
                ? 503
                : 500;

      return json(status, { error: result.error });
    }

    const dto = mapRequestWithdrawOutputToDTO(result.data, parsed.data.amount);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Transfers Request][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
