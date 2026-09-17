import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';
import { createStandaloneCharge, listStandaloneCharges } from '@alusa/finance';
import {
  buildStandaloneChargeInput,
  mapStandaloneChargeCreationResult,
  parseStandaloneChargePayload,
  parseStandaloneChargeListQuery,
} from '@/src/server/finance/standalone-charges-http.service';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok
    ? { id: auth.userId, role: auth.role, contaId: auth.contaId }
    : null;
}

/**
 * GET /api/finance/charges/standalone
 * Lista cobranças avulsas (sem vínculo acadêmico).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Acesso negado' });
    }
    try {
      await assertPlatformAccessForConta({ contaId: user.contaId, capability: 'CHARGE_CREATE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return json(blocked.status, blocked.body);
      throw error;
    }

    const query = parseStandaloneChargeListQuery(new URL(req.url).searchParams);

    const result = await listStandaloneCharges({
      contaId: user.contaId,
      ...query,
    });

    return json(200, {
      data: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (e) {
    console.error('[Finance Charges Standalone][GET]', e);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível criar a cobrança avulsa.' });
  }
}

/**
 * POST /api/finance/charges/standalone
 * 
 * Cria cobrança avulsa (customer-first), sem vínculo com matrícula.
 * Suporta: ONE_TIME (avulsa), INSTALLMENT (parcelada), SUBSCRIPTION (recorrente)
 * 
 * Idempotência: 
 * - Se uiRequestId for enviado, é usado como chave
 * - Caso contrário, calcula hash dos parâmetros
 * - Requisições duplicadas retornam a cobrança existente
 */
export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado' });
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Acesso negado' });
    }

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const { payload, value } = parseStandaloneChargePayload(body);
    const headerIdempotencyKey = req.headers.get('x-idempotency-key')?.trim() || undefined;

    if (payload.amount != null && payload.value == null) {
      console.warn('[finance][charges/standalone] payload legado "amount" utilizado; prefira "value"');
    }

    const result = await createStandaloneCharge({
      ...buildStandaloneChargeInput({
        payload,
        value,
        contaId: user.contaId,
        userId: user.id,
        idempotencyKey: headerIdempotencyKey,
      }),
    });

    const response = mapStandaloneChargeCreationResult(result);
    return json(response.status, response.body);
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, {
        error: 'PAYLOAD_INVALIDO',
        message: 'Dados inválidos',
        details: error.flatten(),
      });
    }

    console.error('[Finance Charges Standalone][POST]', error);
    return json(500, {
      error: 'ERRO_INTERNO',
      message: 'Não foi possível carregar a cobrança.',
    });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
