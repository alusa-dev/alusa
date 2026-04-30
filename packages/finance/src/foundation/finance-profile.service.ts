import { prisma } from '@alusa/database';
import type { FinanceProfile } from '@prisma/client';

import { featureFlagsService } from './feature-flags.service';
import { financeProfileOnboardingDataSchema } from './schemas';

export type FinanceProfileOnboardingData = {
  personType: 'PF' | 'PJ';
  ownerName: string;
  companyName?: string;
  name?: string;
  mobilePhone: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  province: string;
  postalCode: string;
  complement?: string;
  cpfCnpj?: string;
  birthDate?: string;
  companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION' | string;
  loginEmail?: string;
  phone?: string;
  site?: string;
};

function normalizePostalCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 8);
}

function normalizeMobilePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export const financeProfileService = {
  async getOrCreateByTenant(contaId: string): Promise<FinanceProfile> {
    const existing = await prisma.financeProfile.findUnique({ where: { contaId } });
    if (existing) {
      return existing;
    }

    await prisma.financeProfile.createMany({
      data: [{ contaId }],
      skipDuplicates: true,
    });

    const profile = await prisma.financeProfile.findUnique({ where: { contaId } });
    if (!profile) {
      throw new Error('FinanceProfile não encontrado após criação idempotente.');
    }

    return profile;
  },

  async setOnboardingData(contaId: string, data: FinanceProfileOnboardingData): Promise<FinanceProfile> {
    const validated = financeProfileOnboardingDataSchema.parse(data);
    const profile = await this.getOrCreateByTenant(contaId);

    return prisma.financeProfile.update({
      where: { id: profile.id },
      data: {
        asaasName: validated.ownerName,
        asaasOwnerName: validated.ownerName,
        asaasCompanyName: validated.personType === 'PJ' ? validated.companyName ?? null : null,
        asaasLoginEmail: validated.loginEmail,
        asaasPhone: validated.phone,
        asaasSite: validated.site,
        mobilePhone: normalizeMobilePhone(validated.mobilePhone),
        incomeValue: validated.incomeValue,
        address: validated.address,
        addressNumber: validated.addressNumber,
        province: validated.province,
        postalCode: normalizePostalCode(validated.postalCode),
        complement: validated.complement,
        companyType: validated.companyType,
      },
    });
  },

  async syncRegulatoryState(params: {
    contaId: string;
    asaasAccountId?: string | null;
    generalStatus?: string | null;
    syncedAt?: Date;
  }): Promise<FinanceProfile> {
    const syncedAt = params.syncedAt ?? new Date();

    const profile = await this.getOrCreateByTenant(params.contaId);

    const general = (params.generalStatus ?? '').toUpperCase();
    const status = general === 'APPROVED' ? 'APPROVED' : general === 'REJECTED' ? 'REJECTED' : 'PENDING';
    const isOnboardingCompleted = status === 'APPROVED';

    const updatedProfile = await prisma.financeProfile.update({
      where: { id: profile.id },
      data: {
        asaasAccountId: params.asaasAccountId ?? profile.asaasAccountId,
        status,
        isOnboardingCompleted,
        onboardingCompletedAt:
          status === 'APPROVED'
            ? profile.onboardingCompletedAt ?? syncedAt
            : status === 'REJECTED'
              ? null
              : null,
        lastAsaasSyncAt: syncedAt,
      },
    });

    await featureFlagsService.ensureTransferFeaturesForApprovedAccount({
      contaId: params.contaId,
      reason: 'financeProfile.syncRegulatoryState',
    });

    return updatedProfile;
  },
};
