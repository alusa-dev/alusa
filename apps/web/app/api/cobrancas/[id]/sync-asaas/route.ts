import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { cobrancaRouteParamsDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { syncPaymentStateFromAsaas } from '@alusa/finance';
import { resolveCobrancaPaymentLookup } from '@/src/server/finance/resolve-cobranca-payment-lookup';
import { rateLimitAsync } from '@/lib/rate-limit';
import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { invalidateChargeResourceCache } from '@/lib/cache/invalidation';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveSyncLimits() {
  return {
    tenantPerMinute: intFromEnv('FIN_UI_SYNC_TENANT_PER_MINUTE', 30),
    userPerMinute: intFromEnv('FIN_UI_SYNC_USER_PER_MINUTE', 15),
    chargeWindowMs: intFromEnv('FIN_UI_SYNC_CHARGE_WINDOW_MS', 30_000),
  };
}

function jsonSkipped(reason: string, resetAt: number) {
  return NextResponse.json(
    {
      success: true,
      skipped: true,
      reason,
      message: 'Sincronização recente em andamento. A cobrança será atualizada por webhook ou job.',
    },
    {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'x-alusa-sync-skipped': reason,
        'x-ratelimit-reset': String(resetAt),
      },
    },
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; contaId?: string; role?: string } | undefined;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autenticado' }, { status: 401 });
    }

    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json({ success: false, error: 'Sem permissão' }, { status: 403 });
    }

    const { id: cobrancaId } = cobrancaRouteParamsDTOSchema.parse(await params);
    const limits = resolveSyncLimits();

    const tenantLimit = await rateLimitAsync(
      `finance-ui-sync:tenant:${user.contaId}`,
      limits.tenantPerMinute,
      60_000,
    );
    if (!tenantLimit.ok) {
      return jsonSkipped('TENANT_RATE_LIMIT', tenantLimit.resetAt);
    }

    const userLimit = await rateLimitAsync(
      `finance-ui-sync:user:${user.contaId}:${user.id}`,
      limits.userPerMinute,
      60_000,
    );
    if (!userLimit.ok) {
      return jsonSkipped('USER_RATE_LIMIT', userLimit.resetAt);
    }

    const chargeLimit = await rateLimitAsync(
      `finance-ui-sync:charge:${user.contaId}:${cobrancaId}`,
      1,
      limits.chargeWindowMs,
    );
    if (!chargeLimit.ok) {
      return jsonSkipped('CHARGE_THROTTLED', chargeLimit.resetAt);
    }

    const paymentLookup = await resolveCobrancaPaymentLookup(prisma, user.contaId, cobrancaId);
    const paymentId = paymentLookup?.asaasPaymentId ?? null;

    if (!paymentId) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada ou sem integração Asaas' },
        { status: 404 },
      );
    }

    const syncResult = await syncPaymentStateFromAsaas({
      contaId: user.contaId,
      asaasPaymentId: paymentId,
      intent: 'UI_FALLBACK_SYNC',
    });

    if (!syncResult.success) {
      return NextResponse.json(
        { success: false, error: syncResult.error },
        { status: 502 },
      );
    }

    await invalidateChargeResourceCache({
      contaId: user.contaId,
      cobrancaId,
      reason: 'charge-sync-asaas',
    });

    return NextResponse.json({
      success: true,
      message: 'Cobrança sincronizada com o estado oficial do Asaas.',
      asaasPaymentId: syncResult.asaasPaymentId,
      paymentStatus: syncResult.paymentStatus,
      appliedEvent: syncResult.appliedEvent,
      invoiceUrl: syncResult.invoiceUrl,
      bankSlipUrl: syncResult.bankSlipUrl,
      transactionReceiptUrl: syncResult.transactionReceiptUrl,
    });
  } catch (error) {
    const correlationId = logFinanceApiError('POST /api/cobrancas/[id]/sync-asaas', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao sincronizar cobrança com o Asaas',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
