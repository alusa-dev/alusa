import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { asaasGetMyAccountCommercialInfo } from '@alusa/finance';
import { getKycSummary } from '@alusa/finance';
import { contaFinanceOnboardingResultDTOSchema } from '@/features/account/dtos';
import { mapContaFinanceOnboardingResultToDTO } from '@/features/account/mappers';
import { getFinanceOnboardingContext } from '@/src/server/finance/admin-integration.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const contaId = auth.contaId;

    const { financeProfile, credentials } = await getFinanceOnboardingContext(contaId);

    const kycSummary = await (async () => {
      try {
        return await getKycSummary(contaId);
      } catch (error) {
        logApiOperationalEvent({
          severity: 'warn',
          eventName: 'conta.finance_onboarding.kyc_fallback',
          route: '/api/conta/finance-onboarding',
          method: 'GET',
          requestId: getRequestId(req),
          error,
        });
        return null;
      }
    })();

    const commercialInfo = await (async () => {
      if (!credentials?.apiKey) return null;
      try {
        return await asaasGetMyAccountCommercialInfo({ apiKey: credentials.apiKey });
      } catch {
        return null;
      }
    })();

    const commercialInfoExpiration = kycSummary?.myAccountStatus?.commercialInfoExpiration ?? null;
    const derivedCommercialInfoStatus = commercialInfoExpiration?.isExpired === true
      ? 'EXPIRED'
      : commercialInfoExpiration?.scheduledDate
        ? 'EXPIRING_SOON'
        : financeProfile?.asaasAccount?.commercialInfoStatus ?? null;
    const derivedCommercialInfoScheduledDate =
      commercialInfoExpiration?.scheduledDate ?? financeProfile?.asaasAccount?.commercialInfoScheduledDate ?? null;

    const responseBody = mapContaFinanceOnboardingResultToDTO({
      data: {
        financeProfile,
        financialAccount: {
          commercialInfo,
          commercialInfoStatus: derivedCommercialInfoStatus,
          commercialInfoScheduledDate: derivedCommercialInfoScheduledDate,
          commercialInfoExpiration,
          myAccountStatus: kycSummary?.myAccountStatus ?? null,
          documents: kycSummary?.documents ?? null,
          documentsNotReady: Boolean(kycSummary?.documentsNotReady),
          retryAfterMs: kycSummary?.retryAfterMs ?? null,
        },
      },
    });

    return json(200, contaFinanceOnboardingResultDTOSchema.parse(responseBody));
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'conta.finance_onboarding.request_failed',
      route: '/api/conta/finance-onboarding',
      method: 'GET',
      requestId: getRequestId(req),
      error,
    });
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
