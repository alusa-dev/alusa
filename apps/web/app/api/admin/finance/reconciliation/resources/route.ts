import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { runWithTenant } from '@/lib/prisma-tenant';
import { AsaasResourceOriginClassificationError, classifyAsaasResourceOrigin, classifyPreviewedExternalInstallment, classifyPreviewedExternalPayment, classifyPreviewedExternalSubscription, previewExternalInstallmentCandidates, previewExternalPaymentCandidates, previewExternalSubscriptionCandidates } from '@alusa/finance';

export const dynamic = 'force-dynamic';

const classificationSchema = z.object({
  resourceType: z.enum(['SUBSCRIPTION', 'PAYMENT', 'INSTALLMENT']),
  asaasId: z.string().trim().min(1).max(200),
  origin: z.enum(['ALUSA', 'EXTERNAL']),
  reason: z.string().trim().min(8).max(2000),
});

function isRetryableTransactionConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ((error as { code?: string }).code === 'P2034' || (error as { code?: string }).code === 'P2002');
}

export async function GET(req: Request) {
  const scope = await resolveTenantScope(req, { requireAdmin: true });
  if (!scope.ok) return scope.response;
  if (!scope.contaId) return NextResponse.json({ error: { code: 'CONTA_OBRIGATORIA' } }, { status: 400 });
  const query = z.object({ resourceType: z.enum(['SUBSCRIPTION', 'PAYMENT', 'INSTALLMENT']).default('SUBSCRIPTION'), pageSize: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().max(200).optional() })
    .safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) return NextResponse.json({ error: { code: 'PARAMETROS_INVALIDOS' } }, { status: 400 });
  const data = await runWithTenant(scope.contaId, async (tx) => {
    if (query.data.resourceType === 'PAYMENT') {
      return { contaId: scope.contaId!, ...await previewExternalPaymentCandidates({ contaId: scope.contaId!, pageSize: query.data.pageSize, cursor: query.data.cursor, db: tx }) };
    }
    if (query.data.resourceType === 'INSTALLMENT') {
      return { contaId: scope.contaId!, ...await previewExternalInstallmentCandidates({ contaId: scope.contaId!, pageSize: query.data.pageSize, cursor: query.data.cursor, db: tx }) };
    }
    return { contaId: scope.contaId!, ...await previewExternalSubscriptionCandidates({ contaId: scope.contaId!, pageSize: query.data.pageSize, cursor: query.data.cursor, db: tx }) };
  });
  return NextResponse.json({ success: true, data });
}

export async function POST(req: Request) {
  const scope = await resolveTenantScope(req, { requireAdmin: true });
  if (!scope.ok) return scope.response;
  if (!scope.contaId || !scope.user?.id) return NextResponse.json({ error: { code: 'NAO_AUTENTICADO' } }, { status: 401 });
  const parsed = classificationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'DADOS_INVALIDOS', details: parsed.error.flatten() } }, { status: 400 });
  try {
    const classify = () => runWithTenant(scope.contaId!, (tx) => parsed.data.resourceType === 'PAYMENT'
      ? parsed.data.origin === 'EXTERNAL'
        ? classifyPreviewedExternalPayment({ contaId: scope.contaId!, paymentId: parsed.data.asaasId, actorId: scope.user!.id!, reason: parsed.data.reason, db: tx })
        : classifyAsaasResourceOrigin({ contaId: scope.contaId!, resourceType: 'PAYMENT', asaasId: parsed.data.asaasId, origin: 'ALUSA', actorId: scope.user!.id!, reason: parsed.data.reason, db: tx })
      : parsed.data.resourceType === 'INSTALLMENT'
        ? parsed.data.origin === 'EXTERNAL'
          ? classifyPreviewedExternalInstallment({ contaId: scope.contaId!, installmentId: parsed.data.asaasId, actorId: scope.user!.id!, reason: parsed.data.reason, db: tx })
          : classifyAsaasResourceOrigin({ contaId: scope.contaId!, resourceType: 'INSTALLMENT', asaasId: parsed.data.asaasId, origin: 'ALUSA', actorId: scope.user!.id!, reason: parsed.data.reason, db: tx })
        : parsed.data.origin === 'EXTERNAL'
          ? classifyPreviewedExternalSubscription({ contaId: scope.contaId!, subscriptionId: parsed.data.asaasId, actorId: scope.user!.id!, reason: parsed.data.reason, db: tx })
          : classifyAsaasResourceOrigin({ contaId: scope.contaId!, resourceType: 'SUBSCRIPTION', asaasId: parsed.data.asaasId, origin: 'ALUSA', actorId: scope.user!.id!, reason: parsed.data.reason, db: tx }),
    { isolationLevel: 'Serializable' });
    let result: Awaited<ReturnType<typeof classify>>;
    try {
      result = await classify();
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) throw error;
      // Re-read and apply the same eligibility/idempotency checks after a concurrent winner.
      result = await classify();
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof AsaasResourceOriginClassificationError) {
      return NextResponse.json({ error: { code: 'CLASSIFICACAO_REJEITADA', message: error.message } }, { status: 409 });
    }
    const errorType = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : 'unknown_error';
    console.error('[admin][asaas-resource-origin] classification_failed', { errorType });
    return NextResponse.json({
      error: { code: 'ERRO_INTERNO', message: 'Não foi possível classificar o recurso. Tente novamente.' },
    }, { status: 500 });
  }
}
