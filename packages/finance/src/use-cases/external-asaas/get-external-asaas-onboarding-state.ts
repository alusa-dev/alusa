import { prisma } from '@alusa/database';

export type ExternalAsaasOnboardingState = {
  mode: string;
  financeStatus: string;
  status: string;
  schoolName: string;
  cpfCnpj: string | null;
  phone: string | null;
  asaasAccountId: string | null;
  asaasEmail: string | null;
  hasApiKey: boolean;
};

export async function getExternalAsaasOnboardingState(contaId: string): Promise<ExternalAsaasOnboardingState> {
  const conta = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      nome: true,
      cpfCnpj: true,
      financeStatus: true,
      financeIntegrationMode: true,
      externalAsaasOnboardingStatus: true,
      financeProfile: {
        select: {
          mobilePhone: true,
          asaasAccount: {
            select: {
              asaasAccountId: true,
              asaasAccountEmail: true,
              apiKeyEncrypted: true,
            },
          },
        },
      },
    },
  });

  if (!conta) {
    throw new Error('Conta não encontrada.');
  }

  return {
    mode: conta.financeIntegrationMode,
    financeStatus: conta.financeStatus,
    status: conta.externalAsaasOnboardingStatus,
    schoolName: conta.nome,
    cpfCnpj: conta.cpfCnpj ?? null,
    phone: conta.financeProfile?.mobilePhone ?? null,
    asaasAccountId: conta.financeProfile?.asaasAccount?.asaasAccountId ?? null,
    asaasEmail: conta.financeProfile?.asaasAccount?.asaasAccountEmail ?? null,
    hasApiKey: Boolean(conta.financeProfile?.asaasAccount?.apiKeyEncrypted),
  };
}