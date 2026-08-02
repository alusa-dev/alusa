import { NextResponse } from 'next/server';

import { billingAgreementPreviewRequestSchema } from '@/features/cadastro/matriculas/billing-agreements/contracts';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  billingAgreementJsonError,
  billingAgreementUnexpectedError,
  billingAgreementValidationError,
  withBillingAgreementRequest,
} from '@/src/server/billing-agreements/http';
import { previewBillingAgreementWeb } from '@/src/server/billing-agreements/service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withBillingAgreementRequest(async ({ contaId, actorId }) => {
    const rate = await rateLimitAsync(
      `billing-agreement:preview:${contaId}:${actorId}:${ipFromRequest(request)}`,
      60,
      5 * 60_000,
    );
    if (!rate.ok) {
      const response = billingAgreementJsonError(
        429,
        'RATE_LIMITED',
        'Muitas simulações foram solicitadas. Aguarde alguns instantes.',
      );
      response.headers.set('retry-after', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000))));
      return response;
    }

    const parsed = billingAgreementPreviewRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return billingAgreementValidationError(parsed.error);

    try {
      const preview = await previewBillingAgreementWeb({
        contaId,
        actorId,
        request: parsed.data,
      });
      return NextResponse.json(preview, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      return billingAgreementUnexpectedError(error);
    }
  });
}
