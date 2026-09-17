import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  connectExternalAsaasAccount,
  getExternalAsaasOnboardingState,
  type ConnectExternalAsaasAccountResult,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const externalOnboardingSchema = z.object({
  schoolName: z.string().min(2),
  cpfCnpj: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  apiKey: z.string().min(10).max(512),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function isAllowedRole(role: string | undefined): boolean {
  const normalized = role?.toUpperCase() ?? '';
  return normalized === 'ADMIN' || normalized === 'FINANCEIRO';
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!isAllowedRole(auth.role)) return json(403, { error: 'SEM_PERMISSAO' });
    if (auth.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
      return json(409, { error: 'FLUXO_NAO_DISPONIVEL' });
    }

    const state = await getExternalAsaasOnboardingState(auth.contaId);
    return json(200, { data: state });
  } catch (error) {
    console.error('[External Asaas Onboarding][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { success: false, summary: 'Acesso negado.' });
    if (!isAllowedRole(auth.role)) return json(403, { success: false, summary: 'Acesso negado.' });
    if (auth.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
      return json(409, { success: false, summary: 'Fluxo externo indisponível para esta conta.' });
    }

    const parsed = externalOnboardingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json(400, { success: false, summary: 'Dados inválidos para conectar a conta do Asaas.' });
    }

    const result: ConnectExternalAsaasAccountResult = await connectExternalAsaasAccount({
      contaId: auth.contaId,
      schoolName: parsed.data.schoolName,
      cpfCnpj: parsed.data.cpfCnpj,
      phone: parsed.data.phone,
      apiKey: parsed.data.apiKey,
      actor: { id: auth.userId, type: 'ADMIN' },
    });

    if (!result.success) {
      console.warn('[External Asaas Onboarding][RESULT]', {
        contaId: auth.contaId,
        errorCode: result.errorCode,
        retryable: result.retryable ?? false,
      });
    }

    const status = result.success
      ? 200
      : result.errorCode === 'ACCOUNT_ALREADY_LINKED'
        ? 409
        : result.errorCode === 'WEBHOOK_CONFIGURATION_INVALID' || result.errorCode === 'WEBHOOK_LIMIT_REACHED'
          ? 422
          : result.errorCode === 'PROVISIONING_IN_PROGRESS'
            ? 409
            : result.errorCode === 'TEMPORARY_ASAAS_ERROR'
              ? 503
              : result.errorCode === 'UNEXPECTED_ERROR'
                ? 502
                : 400;
    return json(status, result);
  } catch (error) {
    console.error('[External Asaas Onboarding][POST]', error);
    return json(500, {
      success: false,
      summary: 'Erro interno ao conectar a conta do Asaas.',
      errorCode: 'UNEXPECTED_ERROR',
    });
  }
}
