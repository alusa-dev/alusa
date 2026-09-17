import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  buildChargeInvoiceCacheKey,
  invalidateChargeResourceCache,
} from '@/lib/cache/invalidation';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { isCacheLayerEnabled, withTenantCache } from '@/lib/cache/tenant-cache';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { resolveChargeFromRouteRef } from '@/lib/finance/resolve-charge-route-ref';
import { privateJson } from '@/lib/private-cache';
import { financeInternalError } from '@/lib/api/finance-api-response';
import { publicInvoiceProviderErrorMessage } from '@/lib/api/finance-invoice-errors';
import {
  chargeInvoiceResponseSchema,
  scheduleChargeInvoiceInputSchema,
} from '@/features/configuracoes/notafiscal/dtos';
import {
  emitChargeInvoice,
  getChargeInvoiceDetail,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const CHARGE_INVOICE_CACHE_SECONDS = 45;
const CHARGE_INVOICE_STALE_SECONDS = 45;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function scheduleInvoiceErrorStatus(error: string | { kind: string; message: string }): number {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return 422;
  }
  if (error === 'FEATURE_DISABLED') return 403;
  if (error === 'KYC_NAO_APROVADO' || error === 'FISCAL_NOT_READY' || error === 'CHARGE_SEM_PAGAMENTO_ASAAS') {
    return 409;
  }
  if (error === 'CHARGE_NAO_ENCONTRADO') return 404;
  if (error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return 503;
  return 500;
}

function scheduleInvoiceErrorBody(error: string | { kind: string; message: string }) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return {
      error: 'ERRO_AO_AGENDAR_INVOICE',
      message: publicInvoiceProviderErrorMessage(error, 'agendar'),
    };
  }
  return { error };
}

type RouteContext = { params: Promise<{ id: string }> };

type ChargeInvoiceRouteBody = {
  status: number;
  body: unknown;
};

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id: routeRef } = await context.params;
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const loadBody = async (): Promise<ChargeInvoiceRouteBody> => {
      const result = await getChargeInvoiceDetail({ contaId: auth.contaId, routeRef });
      if (!result.success) {
        if (result.error === 'CHARGE_NAO_ENCONTRADO') {
          return { status: 404, body: { error: 'CHARGE_NAO_ENCONTRADA' } };
        }
        return { status: 500, body: { error: 'ERRO_INTERNO' } };
      }

      return {
        status: 200,
        body: { data: chargeInvoiceResponseSchema.parse(result.data) },
      };
    };

    if (!isCacheLayerEnabled()) {
      const loaded = await loadBody();
      return json(loaded.status, loaded.body);
    }

    const cached = await withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildChargeInvoiceCacheKey(auth.contaId, routeRef),
      ttlSeconds: CHARGE_INVOICE_CACHE_SECONDS,
      staleWhileRevalidateSeconds: CHARGE_INVOICE_STALE_SECONDS,
      lockTtlSeconds: 6,
      load: loadBody,
    });

    if (cached.body.status !== 200) {
      return json(cached.body.status, cached.body.body);
    }

    return privateJson(cached.body.body, {
      status: cached.body.status,
      maxAgeSeconds: CHARGE_INVOICE_CACHE_SECONDS,
      staleWhileRevalidateSeconds: CHARGE_INVOICE_STALE_SECONDS,
      cacheState: cached.state,
    });
  } catch (error) {
    return financeInternalError('Cobranca NotaFiscal GET', error, { routeRef: (await context.params).id });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: routeRef } = await context.params;
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const resolved = await resolveChargeFromRouteRef(auth.contaId, routeRef);
    if (!resolved) return json(404, { error: 'CHARGE_NAO_ENCONTRADA' });

    const raw = await req.json().catch(() => ({}));
    const parsed = scheduleChargeInvoiceInputSchema.safeParse(raw);
    if (!parsed.success) return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });

    const result = await emitChargeInvoice({
      contaId: auth.contaId,
      chargeId: resolved.chargeId,
      actor: { type: 'USER', id: auth.userId },
      ...parsed.data,
    });

    if (!result.success) {
      return json(scheduleInvoiceErrorStatus(result.error), scheduleInvoiceErrorBody(result.error));
    }

    await invalidateChargeResourceCache({
      contaId: auth.contaId,
      cobrancaId: routeRef,
      reason: 'charge-invoice-emit',
    });

    const dto = chargeInvoiceResponseSchema.parse(result.data);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Cobranca NotaFiscal][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
