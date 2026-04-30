/**
 * Deprecated: mantido apenas para compatibilidade histórica.
 * Para evitar drift, este use-case delega ao caminho canônico `createAsaasAccount`.
 * Se os dados ainda não estiverem completos, retorna apenas o placeholder local.
 */
import { prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';
import { ZodError } from 'zod';

import { financeProfileService } from '../foundation/finance-profile.service';
import { MissingAsaasApiKeyError } from '../errors/missing-asaas-api-key-error';
import { MissingBirthDateError } from '../errors/missing-birth-date-error';
import { MissingCompanyTypeError } from '../errors/missing-company-type-error';
import { createAsaasAccount } from './asaas-account/create-asaas-account';

export type EnsureAsaasAccountResult = {
  financeProfileId: string;
  asaasAccountId: string | null;
  status: FinancialOnboardingStatus;
};

function isIncompleteProvisioningError(error: unknown): boolean {
  if (error instanceof MissingBirthDateError) return true;
  if (error instanceof MissingCompanyTypeError) return true;
  if (error instanceof ZodError) return true;
  if (error instanceof Error && error.message.startsWith('Dados obrigatórios ausentes:')) return true;
  return false;
}

export async function ensureAsaasAccount(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<EnsureAsaasAccountResult> {
  const financeProfile = await financeProfileService.getOrCreateByTenant(params.contaId);

  const existing = await prisma.asaasAccount.findUnique({ where: { financeProfileId: financeProfile.id } });
  if (existing?.asaasAccountId) {
    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: existing.asaasAccountId,
      status: existing.status,
    };
  }

  if (!existing) {
    await prisma.asaasAccount.create({
      data: {
        financeProfileId: financeProfile.id,
        status: 'NOT_STARTED',
        statusUpdatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  try {
    const created = await createAsaasAccount({ contaId: params.contaId, actor: params.actor });
    return {
      financeProfileId: created.financeProfileId,
      asaasAccountId: created.asaasAccountId,
      status: created.status,
    };
  } catch (error) {
    if (error instanceof MissingAsaasApiKeyError) {
      throw error;
    }

    if (!isIncompleteProvisioningError(error)) {
      throw error;
    }

    const placeholder = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true },
    });

    return {
      financeProfileId: financeProfile.id,
      asaasAccountId: null,
      status: placeholder?.status ?? 'NOT_STARTED',
    };
  }
}
