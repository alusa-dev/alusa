import { NextResponse } from 'next/server';

import { billingAgreementParamsSchema } from '@/features/cadastro/matriculas/billing-agreements/contracts';
import {
  billingAgreementUnexpectedError,
  billingAgreementValidationError,
  withBillingAgreementRequest,
} from '@/src/server/billing-agreements/http';
import { getBillingAgreementWeb } from '@/src/server/billing-agreements/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return withBillingAgreementRequest(async ({ contaId }) => {
    const parsed = billingAgreementParamsSchema.safeParse(await context.params);
    if (!parsed.success) return billingAgreementValidationError(parsed.error);

    try {
      const agreement = await getBillingAgreementWeb({
        contaId,
        agreementId: parsed.data.id,
      });
      return NextResponse.json(agreement, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      return billingAgreementUnexpectedError(error);
    }
  });
}
