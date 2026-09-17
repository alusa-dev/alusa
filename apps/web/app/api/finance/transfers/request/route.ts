import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { verifyCredentialsDetailed } from '@/lib/auth-service';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  requestWithdraw,
  requestWithdrawDTOSchema,
  mapRequestWithdrawDTOToInput,
  mapRequestWithdrawOutputToDTO,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const requestSchema = requestWithdrawDTOSchema.extend({
  currentPassword: z.string().min(1, 'Senha atual obrigatória'),
});

const requestWithdrawErrorStatusMap: Record<string, number> = {
  FEATURE_DISABLED: 403,
  KYC_NAO_APROVADO: 409,
  SALDO_INSUFICIENTE: 400,
  SALDO_INSUFICIENTE_PARA_TAXA: 400,
  OWNER_BIRTH_DATE_OBRIGATORIO: 400,
  PIX_KEY_NAO_ENCONTRADA: 400,
  TRANSFERENCIA_PIX_INDISPONIVEL: 400,
  TRANSFERENCIA_DUPLICADA: 409,
  IDEMPOTENCY_PAYLOAD_CONFLICT: 409,
  AUTORIZACAO_CRITICA_NECESSARIA: 409,
  CREDENCIAIS_ASAAS_INVALIDAS: 503,
  CREDENCIAIS_ASAAS_NAO_CONFIGURADAS: 503,
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(auth.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(auth.contaId);
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

    if (!auth.email) return json(401, { error: 'REAUTENTICACAO_INDISPONIVEL' });

    const credentialCheck = await verifyCredentialsDetailed(auth.email, parsed.data.currentPassword, auth.contaId);
    if (!credentialCheck.ok) {
      return json(401, { error: 'SENHA_INVALIDA' });
    }

    const { currentPassword: _currentPassword, ...transferData } = parsed.data;

    const input = mapRequestWithdrawDTOToInput(transferData, {
      contaId: auth.contaId,
      idempotencyKey,
      actorId: auth.userId,
    });

    const result = await requestWithdraw(input);

    if (!result.success) {
      const status = requestWithdrawErrorStatusMap[result.error] ?? 500;

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
