import { NextResponse } from 'next/server';

import { billingAgreementCommitRequestSchema } from '@/features/cadastro/matriculas/billing-agreements/contracts';
import { invalidateChargesCache } from '@/lib/cache/invalidation';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  billingAgreementJsonError,
  billingAgreementUnexpectedError,
  billingAgreementValidationError,
  withBillingAgreementRequest,
} from '@/src/server/billing-agreements/http';
import { commitBillingAgreementWeb } from '@/src/server/billing-agreements/service';

export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  return withBillingAgreementRequest(async ({ contaId, actorId }) => {
    const rate = await rateLimitAsync(
      `billing-agreement:commit:${contaId}:${actorId}:${ipFromRequest(request)}`,
      20,
      10 * 60_000,
    );
    if (!rate.ok) {
      const response = billingAgreementJsonError(
        429,
        'RATE_LIMITED',
        'Muitas alterações foram solicitadas. Aguarde antes de tentar novamente.',
      );
      response.headers.set('retry-after', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000))));
      return response;
    }

    const rawBody: unknown = await request.json().catch(() => null);
    const headerKey = request.headers.get('idempotency-key')?.trim() || null;
    const bodyKey = isRecord(rawBody) && typeof rawBody.idempotencyKey === 'string'
      ? rawBody.idempotencyKey.trim()
      : null;

    if (headerKey && bodyKey && headerKey !== bodyKey) {
      return billingAgreementJsonError(
        409,
        'IDEMPOTENCY_KEY_MISMATCH',
        'A chave de idempotência do cabeçalho difere da chave do pedido.',
      );
    }

    const parsed = billingAgreementCommitRequestSchema.safeParse(
      isRecord(rawBody) && !bodyKey && headerKey
        ? { ...rawBody, idempotencyKey: headerKey }
        : rawBody,
    );
    if (!parsed.success) return billingAgreementValidationError(parsed.error);

    try {
      const result = await commitBillingAgreementWeb({
        contaId,
        actorId,
        request: parsed.data,
      });
      await Promise.allSettled([
        invalidateChargesCache(contaId, 'billing-agreement-change-accepted'),
      ]);
      const status = result.status === 'APPLIED' ? 200 : 202;
      return NextResponse.json(result, {
        status,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      return billingAgreementUnexpectedError(error);
    }
  });
}
