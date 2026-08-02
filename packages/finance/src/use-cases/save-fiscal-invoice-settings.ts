import { loadAsaasCredentials } from '@alusa/database';
import type { FiscalEmissionMode, FiscalInvoiceEffectiveDatePeriod } from '@prisma/client';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  AsaasHttpError,
  getFiscalInfo as asaasGetFiscalInfo,
  getMunicipalOptions as asaasGetMunicipalOptions,
} from '@alusa/asaas';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { computeFiscalReadiness } from '../fiscal/fiscal-readiness';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { persistFiscalCoreSettings } from '../fiscal/persist-fiscal-core-settings';
import { syncSubscriptionFiscalSettings } from './sync-subscription-fiscal-settings';
import {
  FISCAL_WIZARD_STEP_LABELS,
  inferFiscalWizardStepFromAsaasMessage,
  validateFiscalSettingsDraft,
  type FiscalSettingsValidationIssue,
} from '../fiscal/fiscal-settings-validation';
import type { PersistFiscalCoreSettingsInput } from '../fiscal/persist-fiscal-core-settings';

export type SaveFiscalInvoiceSettingsInput = PersistFiscalCoreSettingsInput & {
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
  defaultDescriptionTemplate?: string;
  defaultObservations?: string;
  defaultDeductions?: number;
  emissionMode?: FiscalEmissionMode;
  invoiceEffectiveDatePeriod?: FiscalInvoiceEffectiveDatePeriod;
  invoiceDaysBeforeDueDate?: number;
  invoiceReceivedOnly?: boolean;
};

export type SaveFiscalInvoiceSettingsOutput = {
  readinessStatus: string;
  ready: boolean;
  issues: Array<{ code: string; message: string; blocking: boolean }>;
  subscriptionSync: {
    total: number;
    succeeded: number;
    failed: number;
    failures: Array<{ subscriptionId: string; kind: 'ACADEMIC' | 'STANDALONE'; error: string }>;
  };
};

export type SaveFiscalInvoiceSettingsError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_INTERNO'
  | SaveFiscalInvoiceSettingsFailure;

export type SaveFiscalInvoiceSettingsFailure = {
  kind: 'VALIDATION' | 'ASAAS';
  step: string;
  message: string;
  details: string[];
  issues?: FiscalSettingsValidationIssue[];
};

function validationFailure(
  issues: FiscalSettingsValidationIssue[],
): SaveFiscalInvoiceSettingsFailure {
  const step = issues[0]?.step ?? 'informacoes';
  return {
    kind: 'VALIDATION',
    step: FISCAL_WIZARD_STEP_LABELS[step],
    message: issues[0]?.message ?? 'Revise os campos obrigatórios antes de salvar.',
    details: issues.map((issue) => `${issue.label}: ${issue.message}`),
    issues,
  };
}

function asaasFailure(error: AsaasHttpError): SaveFiscalInvoiceSettingsFailure {
  const responseBody =
    error.responseBody && typeof error.responseBody === 'object'
      ? (error.responseBody as { errors?: Array<{ description?: string }> })
      : null;
  const details =
    responseBody?.errors
      ?.map((item) => item.description)
      .filter((value): value is string => Boolean(value)) ?? [];
  const message = details.join('; ') || error.message;
  const stepId = inferFiscalWizardStepFromAsaasMessage(message);
  return {
    kind: 'ASAAS',
    step: FISCAL_WIZARD_STEP_LABELS[stepId],
    message,
    details: details.length ? details : [error.message],
  };
}

export async function saveFiscalInvoiceSettings(
  input: SaveFiscalInvoiceSettingsInput,
): Promise<Result<SaveFiscalInvoiceSettingsOutput, SaveFiscalInvoiceSettingsError>> {
  let remoteMutationSucceeded = false;
  try {
    const prisma = getFiscalPrisma();
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const [municipalOptions, remoteFiscalInfo, existingServices] = await Promise.all([
      asaasGetMunicipalOptions({ apiKey: credentials.apiKey }).catch(() => null),
      asaasGetFiscalInfo({ apiKey: credentials.apiKey }).catch(() => null),
      prisma.fiscalService.findMany({
        where: { contaId: input.contaId },
        select: { isDefault: true },
      }),
    ]);

    const validationIssues = validateFiscalSettingsDraft(input, {
      municipalOptions,
      passwordConfigured: remoteFiscalInfo?.passwordSent ?? false,
      accessTokenConfigured: remoteFiscalInfo?.accessTokenSent ?? false,
      certificateConfigured: remoteFiscalInfo?.certificateSent ?? false,
      defaultServiceExists: existingServices.some((service) => service.isDefault),
      useNationalPortal: input.useNationalPortal ?? Boolean(remoteFiscalInfo?.useNationalPortal),
    });
    if (validationIssues.length > 0) {
      return err(validationFailure(validationIssues));
    }

    const persisted = await persistFiscalCoreSettings({
      apiKey: credentials.apiKey,
      input,
      remoteFiscalInfo,
      municipalOptions,
    });
    remoteMutationSucceeded = true;

    const settings = await prisma.contaFiscalSettings.update({
      where: { id: persisted.settings.id },
      data: {
        defaultDescriptionTemplate: input.defaultDescriptionTemplate ?? null,
        defaultObservations: input.defaultObservations ?? null,
        defaultDeductions: input.defaultDeductions ?? null,
        emissionMode: input.emissionMode ?? 'MANUAL',
        invoiceEffectiveDatePeriod:
          input.invoiceEffectiveDatePeriod ?? 'ON_PAYMENT_CONFIRMATION',
        invoiceDaysBeforeDueDate:
          input.invoiceEffectiveDatePeriod === 'BEFORE_PAYMENT_DUE_DATE'
            ? input.invoiceDaysBeforeDueDate ?? 5
            : null,
        invoiceReceivedOnly:
          input.invoiceEffectiveDatePeriod === 'ON_NEXT_MONTH'
            ? input.invoiceReceivedOnly ?? false
            : true,
      },
    });

    const services = await prisma.fiscalService.findMany({ where: { contaId: input.contaId } });
    const readiness = computeFiscalReadiness({
      settings,
      services,
      municipalOptions: persisted.municipalOptionsAfterSave,
      kycApproved: true,
      invoicesEnabled: true,
    });

    await prisma.contaFiscalSettings.update({
      where: { id: settings.id },
      data: {
        readinessStatus: readiness.status,
        readinessIssues: readiness.issues,
      },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.fiscal.settings.saved',
      entity: { type: 'ContaFiscalSettings', id: settings.id },
      metadata: { readinessStatus: readiness.status, ready: readiness.ready },
    });

    const [subscriptions, standaloneSubscriptions] = await Promise.all([
      prisma.subscription.findMany({
        where: {
          contaId: input.contaId,
          status: { in: ['REQUESTED', 'ACTIVE'] },
          asaasSubscriptionId: { not: null },
        },
        select: { id: true, asaasSubscriptionId: true },
      }),
      prisma.standaloneSubscription.findMany({
        where: {
          contaId: input.contaId,
          status: { in: ['REQUESTED', 'ACTIVE'] },
          asaasSubscriptionId: { not: null },
        },
        select: { id: true, asaasSubscriptionId: true },
      }),
    ]);

    const syncTargets = [
      ...subscriptions.map((subscription) => ({ ...subscription, kind: 'ACADEMIC' as const })),
      ...standaloneSubscriptions.map((subscription) => ({ ...subscription, kind: 'STANDALONE' as const })),
    ];
    const syncResults = await Promise.allSettled(
      syncTargets.map((subscription) =>
        syncSubscriptionFiscalSettings({
          contaId: input.contaId,
          subscriptionId: subscription.id,
          asaasSubscriptionId: subscription.asaasSubscriptionId!,
          kind: subscription.kind,
          actor: input.actor,
        }),
      ),
    );
    const failures = syncResults.flatMap((result, index) => {
      if (result.status === 'rejected') {
        return [{
          subscriptionId: syncTargets[index]!.id,
          kind: syncTargets[index]!.kind,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }];
      }
      if (!result.value.success) {
        return [{
          subscriptionId: syncTargets[index]!.id,
          kind: syncTargets[index]!.kind,
          error: typeof result.value.error === 'string'
            ? result.value.error
            : JSON.stringify(result.value.error),
        }];
      }
      return [];
    });

    if (failures.length > 0) {
      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.fiscal.subscription_sync.partial_failure',
        entity: { type: 'ContaFiscalSettings', id: settings.id },
        metadata: { total: syncTargets.length, failures },
      });
    }

    return ok({
      readinessStatus: readiness.status,
      ready: readiness.ready,
      issues: readiness.issues,
      subscriptionSync: {
        total: syncTargets.length,
        succeeded: syncTargets.length - failures.length,
        failed: failures.length,
        failures,
      },
    });
  } catch (error) {
    console.error('[finance][saveFiscalInvoiceSettings]', error);
    if (error instanceof AsaasHttpError) {
      return err(asaasFailure(error));
    }
    if (remoteMutationSucceeded) {
      await getFiscalPrisma()
        .contaFiscalSettings.update({
          where: { contaId: input.contaId },
          data: {
            syncStatus: 'DIVERGED',
            lastSyncError:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Falha local após salvar dados fiscais no Asaas.',
          },
        })
        .catch(() => undefined);
    }
    return err('ERRO_INTERNO');
  }
}

export async function getFiscalReadiness(input: {
  contaId: string;
}): Promise<Result<SaveFiscalInvoiceSettingsOutput, SaveFiscalInvoiceSettingsError>> {
  const result = await import('./get-fiscal-invoice-settings').then((m) =>
    m.getFiscalInvoiceSettings({ contaId: input.contaId }),
  );
  if (!result.success) return result;
  return ok({
    readinessStatus: result.data.readiness.status,
    ready: result.data.readiness.ready,
    issues: result.data.readiness.issues,
    subscriptionSync: { total: 0, succeeded: 0, failed: 0, failures: [] },
  });
}
