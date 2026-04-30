/**
 * KYC Gate Guard
 *
 * Gate obrigatório antes de qualquer operação financeira
 * (criar cobrança, criar assinatura, etc.).
 *
 * Verifica se:
 * - FinancialOnboardingStatus === APPROVED
 * - commercialInfoStatus !== EXPIRED
 *
 * Sem esse gate, operações financeiras podem ser executadas
 * em subcontas que o Asaas rejeitou ou cujos dados expiraram.
 */

import { prisma } from '@alusa/database';
import type { FinancialOnboardingStatus } from '@prisma/client';
import { isPendingDocumentsBlockBypassedForTesting } from '../foundation/kyc-test-bypass';

export type KycGateResult = {
  allowed: boolean;
  reason?: string;
  onboardingStatus?: FinancialOnboardingStatus;
  commercialInfoStatus?: string | null;
};

/**
 * Verifica se a conta está apta para operações financeiras.
 * Deve ser chamada antes de criar cobranças, assinaturas, etc.
 */
export async function checkKycGate(contaId: string): Promise<KycGateResult> {
  const bypassPendingDocumentsBlock = isPendingDocumentsBlockBypassedForTesting();
  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: {
      status: true,
      commercialInfoStatus: true,
    },
  });

  if (!asaasAccount) {
    return {
      allowed: false,
      reason: 'Subconta Asaas não encontrada',
    };
  }

  if (asaasAccount.status !== 'APPROVED' && !bypassPendingDocumentsBlock) {
    return {
      allowed: false,
      reason: `Onboarding não aprovado (status: ${asaasAccount.status})`,
      onboardingStatus: asaasAccount.status,
      commercialInfoStatus: asaasAccount.commercialInfoStatus,
    };
  }

  if (asaasAccount.commercialInfoStatus === 'EXPIRED') {
    return {
      allowed: false,
      reason: 'Dados comerciais expirados no Asaas',
      onboardingStatus: asaasAccount.status,
      commercialInfoStatus: asaasAccount.commercialInfoStatus,
    };
  }

  return {
    allowed: true,
    onboardingStatus: asaasAccount.status,
    commercialInfoStatus: asaasAccount.commercialInfoStatus,
  };
}
