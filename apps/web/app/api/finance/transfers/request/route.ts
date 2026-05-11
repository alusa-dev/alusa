import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { verifyCredentialsDetailed } from '@/lib/auth-service';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  requestWithdraw,
  requestWithdrawDTOSchema,
  mapRequestWithdrawDTOToInput,
  mapRequestWithdrawOutputToDTO,
} from '@alusa/finance';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
  email?: string | null;
  financeIntegrationMode?: string | null;
};

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const requestSchema = requestWithdrawDTOSchema.extend({
  currentPassword: z.string().min(1, 'Senha atual obrigatória'),
});

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

    const capabilityBlock = blockUnavailableFinanceCapability(user.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const idempotencyKey = req.headers.get('Idempotency-Key');
    if (!idempotencyKey) return json(400, { error: 'IDEMPOTENCY_KEY_OBRIGATORIO' });

    const raw = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    if (!user.email) return json(401, { error: 'REAUTENTICACAO_INDISPONIVEL' });

    const credentialCheck = await verifyCredentialsDetailed(user.email, parsed.data.currentPassword, user.contaId);
    if (!credentialCheck.ok) {
      return json(401, { error: 'SENHA_INVALIDA' });
    }

    const { currentPassword: _currentPassword, ...transferData } = parsed.data;

    const input = mapRequestWithdrawDTOToInput(transferData, {
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
              : result.error === 'PIX_KEY_NAO_ENCONTRADA'
                ? 400
                : result.error === 'TRANSFERENCIA_PIX_INDISPONIVEL'
                  ? 400
                : result.error === 'TRANSFERENCIA_DUPLICADA'
                  ? 409
                  : result.error === 'IDEMPOTENCY_PAYLOAD_CONFLICT'
                    ? 409
                  : result.error === 'AUTORIZACAO_CRITICA_NECESSARIA'
                    ? 409
                    : result.error === 'CREDENCIAIS_ASAAS_INVALIDAS'
                      ? 503
              : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
                ? 503
                : 500;

      return json(status, { error: result.error });
    }

    const dto = mapRequestWithdrawOutputToDTO(result.data, transferData.amount);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Transfers Request][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
