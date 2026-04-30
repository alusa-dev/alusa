import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { getMyAccountCommercialInfo } from '@alusa/asaas';
import { getKycSummary } from '@alusa/finance';
import { loadAsaasCredentials } from '@alusa/database';
import { contaFinanceOnboardingResultDTOSchema } from '@/features/conta/dtos';
import { mapContaFinanceOnboardingResultToDTO } from '@/features/conta/mappers';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const contaId = user.contaId;

    const financeProfile = await prisma.financeProfile.findUnique({
      where: { contaId },
      select: {
        id: true,
        asaasAccountId: true,
        status: true,
        isOnboardingCompleted: true,
        onboardingCompletedAt: true,
        lastAsaasSyncAt: true,
        mobilePhone: true,
        incomeValue: true,
        address: true,
        addressNumber: true,
        province: true,
        postalCode: true,
        complement: true,
        asaasOwnerName: true,
        asaasCompanyName: true,
        asaasLoginEmail: true,
        asaasPhone: true,
        asaasSite: true,
        asaasName: true,
        updatedAt: true,
        createdAt: true,
        asaasAccount: {
          select: {
            commercialInfoStatus: true,
            commercialInfoScheduledDate: true,
          },
        },
      },
    });

    const kycSummary = await (async () => {
      try {
        return await getKycSummary(contaId);
      } catch (error) {
        console.warn('[Conta Finance Onboarding][GET][KYC_FALLBACK]', error);
        return null;
      }
    })();

    const creds = await loadAsaasCredentials(contaId);
    const commercialInfo = await (async () => {
      if (!creds?.apiKey) return null;
      try {
        return await getMyAccountCommercialInfo({ apiKey: creds.apiKey });
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

    return json(
      200,
      mapContaFinanceOnboardingResultToDTO({
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
      }),
    );
  } catch (error) {
    console.error('[Conta Finance Onboarding][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
