import { loadAsaasCredentials } from '@alusa/database';
import { prisma } from '@/src/prisma';

export async function getAsaasAdminTestContext(contaId: string) {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      asaasAccountId: true,
      asaasCredential: { select: { apiKeyEncrypted: true } },
    },
  });
  const credentials = await loadAsaasCredentials(contaId);

  return { profile, credentials };
}

export async function hasAsaasCredentials(contaId: string) {
  const credentials = await loadAsaasCredentials(contaId);
  return Boolean(credentials?.apiKey);
}

export async function getFinanceOnboardingContext(contaId: string) {
  const [financeProfile, credentials] = await Promise.all([
    prisma.financeProfile.findUnique({
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
    }),
    loadAsaasCredentials(contaId),
  ]);
  return { financeProfile, credentials };
}
