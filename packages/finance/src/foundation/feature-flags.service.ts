import { parseAsaasEnvironmentFromEnv } from '@alusa/asaas';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { TenantFeatureFlags } from '@prisma/client';

import { auditLogService, type AuditActorRef } from './audit-log.service';
import { isPendingDocumentsBlockBypassedForTesting } from './kyc-test-bypass';

export type FinancialFeatureFlag = keyof Pick<
  TenantFeatureFlags,
  | 'enableSubscriptions'
  | 'enableInstallments'
  | 'enableManualWithdraw'
  | 'enablePixTransfer'
  | 'enableBankTransfer'
  | 'enableSplitPayments'
  | 'enableEscrow'
  | 'enableInvoices'
  | 'enablePaymentLinks'
  | 'enableChargebackHandling'
  | 'enableDunning'
>;

// Flags que são habilitadas automaticamente quando a conta tem credenciais Asaas
const AUTO_ENABLE_WITH_CREDENTIALS: FinancialFeatureFlag[] = [
  'enableSubscriptions',
  'enableInstallments',
  'enableInvoices',
  'enablePaymentLinks',
];

const AUTO_PROVISION_TRANSFER_FLAGS = [
  'enableManualWithdraw',
  'enablePixTransfer',
  'enableBankTransfer',
] as const satisfies readonly FinancialFeatureFlag[];

type AutoProvisionTransferFlag = (typeof AUTO_PROVISION_TRANSFER_FLAGS)[number];

type AutoProvisionTransferFeaturesResult = {
  changed: boolean;
  enabledFlags: AutoProvisionTransferFlag[];
  skippedReason:
    | 'POLICY_DISABLED'
    | 'FINANCE_PROFILE_NOT_FOUND'
    | 'ONBOARDING_NOT_APPROVED'
    | 'ASAAS_ACCOUNT_NOT_APPROVED'
    | null;
};

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return null;
}

function shouldAutoProvisionTransferFeatures(): boolean {
  const override = parseBooleanEnv(process.env.ASAAS_AUTO_PROVISION_TRANSFER_FEATURES);
  if (override !== null) return override;

  const env = parseAsaasEnvironmentFromEnv();
  const baseUrl = (process.env.ASAAS_BASE_URL ?? '').toLowerCase();
  return env === 'sandbox' || (env === 'unknown' && baseUrl.includes('api-sandbox.asaas.com'));
}

function buildTransferFlagPatch(flags: readonly AutoProvisionTransferFlag[]): Record<AutoProvisionTransferFlag, true> {
  return Object.fromEntries(flags.map((flag) => [flag, true])) as Record<AutoProvisionTransferFlag, true>;
}

export const featureFlagsService = {
  async isEnabled(contaId: string, flag: FinancialFeatureFlag): Promise<boolean> {
    const flags = await prisma.tenantFeatureFlags.findUnique({
      where: { contaId },
      select: { [flag]: true } as Record<FinancialFeatureFlag, true>,
    });

    // Se existe registro e a flag está habilitada, retorna true
    if (flags?.[flag]) {
      return true;
    }

    // Se a flag não está habilitada explicitamente, verificar se deve ser auto-habilitada
    if (AUTO_ENABLE_WITH_CREDENTIALS.includes(flag)) {
      const credentials = await loadAsaasCredentials(contaId);
      if (credentials?.apiKey) {
        // Conta tem credenciais Asaas configuradas, habilitar automaticamente
        return true;
      }
    }

    return false;
  },

  async getTransferFeatureFlags(contaId: string): Promise<{
    manualWithdrawEnabled: boolean;
    pixTransferEnabled: boolean;
    bankTransferEnabled: boolean;
  }> {
    const flags = await prisma.tenantFeatureFlags.findUnique({
      where: { contaId },
      select: {
        enableManualWithdraw: true,
        enablePixTransfer: true,
        enableBankTransfer: true,
      },
    });

    return {
      manualWithdrawEnabled: Boolean(flags?.enableManualWithdraw),
      pixTransferEnabled: Boolean(flags?.enablePixTransfer),
      bankTransferEnabled: Boolean(flags?.enableBankTransfer),
    };
  },

  async getOrCreate(contaId: string): Promise<TenantFeatureFlags> {
    const existing = await prisma.tenantFeatureFlags.findUnique({ where: { contaId } });
    if (existing) return existing;
    return prisma.tenantFeatureFlags.create({ data: { contaId } });
  },

  async ensureTransferFeaturesForApprovedAccount(params: {
    contaId: string;
    actor?: AuditActorRef;
    reason: string;
  }): Promise<AutoProvisionTransferFeaturesResult> {
    const bypassPendingDocumentsBlock = isPendingDocumentsBlockBypassedForTesting();

    if (!shouldAutoProvisionTransferFeatures()) {
      return { changed: false, enabledFlags: [], skippedReason: 'POLICY_DISABLED' };
    }

    const profile = await prisma.financeProfile.findUnique({
      where: { contaId: params.contaId },
      select: { id: true, isOnboardingCompleted: true },
    });

    if (!profile) {
      return { changed: false, enabledFlags: [], skippedReason: 'FINANCE_PROFILE_NOT_FOUND' };
    }

    if (!profile.isOnboardingCompleted && !bypassPendingDocumentsBlock) {
      return { changed: false, enabledFlags: [], skippedReason: 'ONBOARDING_NOT_APPROVED' };
    }

    const asaasAccount = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: profile.id },
      select: { id: true, status: true },
    });

    if (!asaasAccount) {
      return { changed: false, enabledFlags: [], skippedReason: 'ASAAS_ACCOUNT_NOT_APPROVED' };
    }

    if (asaasAccount.status !== 'APPROVED' && !bypassPendingDocumentsBlock) {
      return { changed: false, enabledFlags: [], skippedReason: 'ASAAS_ACCOUNT_NOT_APPROVED' };
    }

    const existing = await prisma.tenantFeatureFlags.findUnique({
      where: { contaId: params.contaId },
      select: {
        id: true,
        enableManualWithdraw: true,
        enablePixTransfer: true,
        enableBankTransfer: true,
      },
    });

    const enabledFlags = AUTO_PROVISION_TRANSFER_FLAGS.filter((flag) => !existing?.[flag]);
    if (enabledFlags.length === 0) {
      return { changed: false, enabledFlags: [], skippedReason: null };
    }

    const patch = buildTransferFlagPatch(enabledFlags);
    const flags = await prisma.tenantFeatureFlags.upsert({
      where: { contaId: params.contaId },
      create: { contaId: params.contaId, ...patch },
      update: patch,
      select: { id: true },
    });

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.features.auto_provision_transfers',
      entity: { type: 'TenantFeatureFlags', id: flags.id },
      metadata: {
        reason: params.reason,
        enabledFlags,
        environment: parseAsaasEnvironmentFromEnv(),
        autoProvisionPolicy: bypassPendingDocumentsBlock ? 'test_pending_documents_bypass' : 'approved_sandbox_account',
      },
      actor: params.actor,
    });

    return { changed: true, enabledFlags, skippedReason: null };
  },
};
