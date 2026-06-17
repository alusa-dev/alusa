import { loadAsaasCredentials } from '@alusa/database';
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
import {
  FISCAL_WIZARD_STEP_LABELS,
  inferFiscalWizardStepFromAsaasMessage,
  validateFiscalCoreSettingsDraft,
  type FiscalSettingsValidationIssue,
} from '../fiscal/fiscal-settings-validation';
import type { SaveFiscalInvoiceSettingsFailure } from './save-fiscal-invoice-settings';
import type { PersistFiscalCoreSettingsInput } from '../fiscal/persist-fiscal-core-settings';

export type SaveFiscalCoreSettingsInput = PersistFiscalCoreSettingsInput & {
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type SaveFiscalCoreSettingsOutput = {
  asaasFiscalSyncedAt: string;
  readinessStatus: string;
  ready: boolean;
  issues: Array<{ code: string; message: string; blocking: boolean }>;
};

export type SaveFiscalCoreSettingsError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_INTERNO'
  | SaveFiscalInvoiceSettingsFailure;

function validationFailure(
  issues: FiscalSettingsValidationIssue[],
): SaveFiscalInvoiceSettingsFailure {
  const step = issues[0]?.step ?? 'informacoes';
  return {
    kind: 'VALIDATION',
    step: FISCAL_WIZARD_STEP_LABELS[step],
    message: issues[0]?.message ?? 'Revise os campos obrigatórios antes de continuar.',
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

export async function saveFiscalCoreSettings(
  input: SaveFiscalCoreSettingsInput,
): Promise<Result<SaveFiscalCoreSettingsOutput, SaveFiscalCoreSettingsError>> {
  let remoteMutationSucceeded = false;
  try {
    const prisma = getFiscalPrisma();
    const enabled = await featureFlagsService.isEnabled(input.contaId, 'enableInvoices');
    if (!enabled) return err('FEATURE_DISABLED');

    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err('KYC_NAO_APROVADO');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const [municipalOptions, remoteFiscalInfo] = await Promise.all([
      asaasGetMunicipalOptions({ apiKey: credentials.apiKey }).catch(() => null),
      asaasGetFiscalInfo({ apiKey: credentials.apiKey }).catch(() => null),
    ]);

    const validationIssues = validateFiscalCoreSettingsDraft(input, {
      municipalOptions,
      passwordConfigured: remoteFiscalInfo?.passwordSent ?? false,
      accessTokenConfigured: remoteFiscalInfo?.accessTokenSent ?? false,
      certificateConfigured: remoteFiscalInfo?.certificateSent ?? false,
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

    const services = await prisma.fiscalService.findMany({ where: { contaId: input.contaId } });
    const readiness = computeFiscalReadiness({
      settings: persisted.settings,
      services,
      municipalOptions: persisted.municipalOptionsAfterSave,
      kycApproved: true,
      invoicesEnabled: true,
    });

    await prisma.contaFiscalSettings.update({
      where: { id: persisted.settings.id },
      data: {
        readinessStatus: readiness.status,
        readinessIssues: readiness.issues,
      },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.fiscal.core.saved',
      entity: { type: 'ContaFiscalSettings', id: persisted.settings.id },
      metadata: {
        readinessStatus: readiness.status,
        ready: readiness.ready,
        asaasFiscalSyncedAt: persisted.syncedAt.toISOString(),
      },
    });

    return ok({
      asaasFiscalSyncedAt: persisted.syncedAt.toISOString(),
      readinessStatus: readiness.status,
      ready: readiness.ready,
      issues: readiness.issues,
    });
  } catch (error) {
    console.error('[finance][saveFiscalCoreSettings]', error);
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
                : 'Falha local após salvar núcleo fiscal no Asaas.',
          },
        })
        .catch(() => undefined);
    }
    return err('ERRO_INTERNO');
  }
}
