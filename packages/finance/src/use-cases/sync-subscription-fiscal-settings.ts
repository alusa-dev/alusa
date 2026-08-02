import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  AsaasHttpError,
  deleteSubscriptionInvoiceSettingsIfConfigured,
  findSubscriptionInvoiceSettings,
  getMunicipalOptions as asaasGetMunicipalOptions,
  updateSubscriptionInvoiceSettings,
  upsertSubscriptionInvoiceSettings,
  type UpsertSubscriptionInvoiceSettingsInput,
} from '@alusa/asaas';

import { auditLogService } from '../foundation/audit-log.service';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { computeFiscalReadiness } from '../fiscal/fiscal-readiness';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import {
  buildAsaasInvoiceTaxes,
  validateAsaasInvoiceTaxesInput,
} from '../fiscal/invoice-taxes';
import {
  buildFinanceReconciliationIssueDedupeKey,
  resolveFinanceReconciliationIssueByDedupe,
  upsertFinanceReconciliationIssue,
} from '../reconciliation/finance-reconciliation-issue.service';

export type SyncSubscriptionFiscalSettingsInput = {
  contaId: string;
  subscriptionId: string;
  asaasSubscriptionId: string;
  kind?: 'ACADEMIC' | 'STANDALONE';
  action?: 'UPSERT' | 'DELETE';
  actor?: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type SyncSubscriptionFiscalSettingsOutput = {
  configured: boolean;
  action: 'UPSERTED' | 'DELETED' | 'SKIPPED';
  reason?: string;
};

export type SyncSubscriptionFiscalSettingsError =
  | 'SUBSCRIPTION_NAO_ENCONTRADA'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_ASAAS'
  | 'ERRO_INTERNO';

function asNumber(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fiscalSettingsIssueDedupe(input: SyncSubscriptionFiscalSettingsInput): string {
  return buildFinanceReconciliationIssueDedupeKey({
    entityType: 'SUBSCRIPTION',
    entityId: input.subscriptionId,
    asaasId: input.asaasSubscriptionId,
    issueType: 'SUBSCRIPTION_STATUS_DRIFT',
  });
}

async function resolveFiscalSettingsIssue(input: SyncSubscriptionFiscalSettingsInput) {
  await resolveFinanceReconciliationIssueByDedupe({
    contaId: input.contaId,
    dedupeKey: fiscalSettingsIssueDedupe(input),
    resolution: 'Configuração fiscal da assinatura reconciliada com o Asaas.',
  });
}

function buildTaxes(service: {
  simplesNacional: boolean;
  useNationalPortal?: boolean | null;
  retainIss: boolean;
  iss: unknown;
  pis: unknown;
  cofins: unknown;
  csll: unknown;
  inss: unknown;
  ir: unknown;
  nbsCode: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  pisCofinsTaxStatus: string | null;
  operationPis: unknown;
  operationCofins: unknown;
  useTaxSystemReformNT007: boolean;
}): NonNullable<UpsertSubscriptionInvoiceSettingsInput['taxes']> {
  return buildAsaasInvoiceTaxes({
    simplesNacional: service.simplesNacional,
    useNationalPortal: service.useNationalPortal,
    retainIss: service.retainIss,
    iss: asNumber(service.iss),
    pis: service.pis == null ? null : asNumber(service.pis),
    cofins: service.cofins == null ? null : asNumber(service.cofins),
    csll: asNumber(service.csll),
    inss: asNumber(service.inss),
    ir: asNumber(service.ir),
    nbsCode: service.nbsCode,
    taxSituationCode: service.taxSituationCode,
    taxClassificationCode: service.taxClassificationCode,
    operationIndicatorCode: service.operationIndicatorCode,
    pisCofinsTaxStatus: service.pisCofinsTaxStatus,
    operationPis: service.operationPis == null ? null : asNumber(service.operationPis),
    operationCofins: service.operationCofins == null ? null : asNumber(service.operationCofins),
    useTaxSystemReformNT007: service.useTaxSystemReformNT007,
  });
}

async function markLocal(input: SyncSubscriptionFiscalSettingsInput & {
  configured?: boolean;
  error?: string | null;
}) {
  const prisma = getFiscalPrisma();
  const data = {
    asaasInvoiceSettingsConfigured: input.configured,
    fiscalInvoiceSettingsSyncedAt: input.error ? undefined : new Date(),
    fiscalInvoiceSettingsError: input.error ?? null,
  };

  if (input.kind === 'STANDALONE') {
    await prisma.standaloneSubscription.update({
      where: { id: input.subscriptionId },
      data,
    });
    return;
  }

  await prisma.subscription.update({
    where: { id: input.subscriptionId },
    data,
  });
}

async function assertLocalSubscription(input: SyncSubscriptionFiscalSettingsInput) {
  const prisma = getFiscalPrisma();
  if (input.kind === 'STANDALONE') {
    return prisma.standaloneSubscription.findFirst({
      where: {
        id: input.subscriptionId,
        contaId: input.contaId,
        asaasSubscriptionId: input.asaasSubscriptionId,
      },
      select: { id: true },
    });
  }

  return prisma.subscription.findFirst({
    where: {
      id: input.subscriptionId,
      contaId: input.contaId,
      asaasSubscriptionId: input.asaasSubscriptionId,
    },
    select: { id: true },
  });
}

export async function syncSubscriptionFiscalSettings(
  input: SyncSubscriptionFiscalSettingsInput,
): Promise<Result<SyncSubscriptionFiscalSettingsOutput, SyncSubscriptionFiscalSettingsError>> {
  const actor = input.actor ?? { type: 'SYSTEM' as const };
  let deletionOutcomeUnknown = false;

  try {
    const local = await assertLocalSubscription(input);
    if (!local) return err('SUBSCRIPTION_NAO_ENCONTRADA');

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const prisma = getFiscalPrisma();
    const [invoicesEnabled, kyc, settings, services, municipalOptions] = await Promise.all([
      featureFlagsService.isEnabled(input.contaId, 'enableInvoices'),
      requireKycApproved(input.contaId),
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findMany({ where: { contaId: input.contaId } }),
      asaasGetMunicipalOptions({ apiKey: credentials.apiKey }).catch(() => null),
    ]);

    const readiness = computeFiscalReadiness({
      settings,
      services,
      municipalOptions,
      kycApproved: kyc.success,
      invoicesEnabled,
    });

    const shouldDelete =
      input.action === 'DELETE' ||
      settings?.simplesNacional === false ||
      !invoicesEnabled ||
      !readiness.ready ||
      settings?.emissionMode !== 'ON_PAYMENT';

    if (shouldDelete) {
      deletionOutcomeUnknown = true;
      await deleteSubscriptionInvoiceSettingsIfConfigured({
        apiKey: credentials.apiKey,
        subscriptionId: input.asaasSubscriptionId,
      });
      deletionOutcomeUnknown = false;

      await markLocal({ ...input, configured: false });
      await resolveFiscalSettingsIssue(input).catch(() => undefined);
      await auditLogService.record({
        contaId: input.contaId,
        actor,
        action: 'finance.subscription.invoice_settings.deleted',
        entity: { type: input.kind === 'STANDALONE' ? 'StandaloneSubscription' : 'Subscription', id: input.subscriptionId },
        metadata: {
          asaasSubscriptionId: input.asaasSubscriptionId,
          reason: input.action === 'DELETE' ? 'REQUESTED' : 'NOT_ELIGIBLE',
          readinessStatus: readiness.status,
        },
      });
      return ok({
        configured: false,
        action: 'DELETED',
        reason: settings?.simplesNacional === false
          ? 'IBS_CBS_REQUIRES_LOCAL_EMISSION'
          : 'NOT_ELIGIBLE',
      });
    }

    const defaultService = services.find((service) => service.isDefault);
    if (!settings || !defaultService) {
      return ok({ configured: false, action: 'SKIPPED', reason: 'FISCAL_NOT_READY' });
    }

    const pisCofinsIssues = validateAsaasInvoiceTaxesInput({
      simplesNacional: settings.simplesNacional,
      useNationalPortal: Boolean(settings.useNationalPortal),
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      pis: asNumber(defaultService.pis),
      cofins: asNumber(defaultService.cofins),
      operationPis: defaultService.operationPis == null ? null : asNumber(defaultService.operationPis),
      operationCofins:
        defaultService.operationCofins == null ? null : asNumber(defaultService.operationCofins),
      retainIss: defaultService.retainIss,
      iss: asNumber(defaultService.iss),
      csll: asNumber(defaultService.csll),
      inss: asNumber(defaultService.inss),
      ir: asNumber(defaultService.ir),
    });
    if (pisCofinsIssues.length > 0) {
      const message =
        pisCofinsIssues[0]?.message ?? 'Revise PIS/COFINS do serviço fiscal padrão.';
      await markLocal({ ...input, configured: false, error: message });
      return ok({ configured: false, action: 'SKIPPED', reason: 'PIS_COFINS_INVALIDO' });
    }

    const usesProviderMunicipalService = Boolean(defaultService.asaasMunicipalServiceId);
    const effectiveDatePeriod =
      settings.invoiceEffectiveDatePeriod ?? 'ON_PAYMENT_CONFIRMATION';
    const payload: UpsertSubscriptionInvoiceSettingsInput = {
      municipalServiceId: usesProviderMunicipalService
        ? defaultService.asaasMunicipalServiceId ?? undefined
        : undefined,
      municipalServiceCode: usesProviderMunicipalService
        ? undefined
        : defaultService.municipalServiceCode,
      municipalServiceName: defaultService.name,
      deductions: settings.defaultDeductions == null ? 0 : Number(settings.defaultDeductions),
      effectiveDatePeriod,
      daysBeforeDueDate:
        effectiveDatePeriod === 'BEFORE_PAYMENT_DUE_DATE'
          ? settings.invoiceDaysBeforeDueDate ?? 5
          : undefined,
      receivedOnly:
        effectiveDatePeriod === 'ON_NEXT_MONTH'
          ? settings.invoiceReceivedOnly
          : undefined,
      observations: settings.defaultObservations ?? undefined,
      taxes: buildTaxes({
        ...defaultService,
        simplesNacional: settings.simplesNacional,
        useNationalPortal: settings.useNationalPortal,
      }),
    };

    const existingSettings = await findSubscriptionInvoiceSettings({
      apiKey: credentials.apiKey,
      subscriptionId: input.asaasSubscriptionId,
    });

    if (existingSettings) {
      await updateSubscriptionInvoiceSettings({
        apiKey: credentials.apiKey,
        subscriptionId: input.asaasSubscriptionId,
        data: payload,
      });
    } else {
      await upsertSubscriptionInvoiceSettings({
        apiKey: credentials.apiKey,
        subscriptionId: input.asaasSubscriptionId,
        data: payload,
      });
    }

    await markLocal({ ...input, configured: true });
    await resolveFiscalSettingsIssue(input).catch(() => undefined);
    await auditLogService.record({
      contaId: input.contaId,
      actor,
      action: 'finance.subscription.invoice_settings.upserted',
      entity: { type: input.kind === 'STANDALONE' ? 'StandaloneSubscription' : 'Subscription', id: input.subscriptionId },
      metadata: {
        asaasSubscriptionId: input.asaasSubscriptionId,
        effectiveDatePeriod: payload.effectiveDatePeriod,
        municipalServiceId: payload.municipalServiceId ?? null,
        municipalServiceCode: payload.municipalServiceCode ?? null,
      },
    });

    return ok({ configured: true, action: 'UPSERTED' });
  } catch (error) {
    console.error('[finance][syncSubscriptionFiscalSettings]', error);
    await markLocal({
      ...input,
      configured: deletionOutcomeUnknown ? true : undefined,
      error: error instanceof Error ? error.message.slice(0, 1000) : 'Erro interno',
    }).catch(() => undefined);
    await upsertFinanceReconciliationIssue({
      contaId: input.contaId,
      entityType: 'SUBSCRIPTION',
      entityId: input.subscriptionId,
      asaasId: input.asaasSubscriptionId,
      issueType: 'SUBSCRIPTION_STATUS_DRIFT',
      severity: deletionOutcomeUnknown ? 'HIGH' : 'MEDIUM',
      localStatus: deletionOutcomeUnknown ? 'PROVIDER_NATIVE_PRESERVED' : 'SYNC_FAILED',
      remoteStatus: 'UNKNOWN',
      metadata: {
        scope: 'INVOICE_SETTINGS',
        kind: input.kind ?? 'ACADEMIC',
        deletionOutcomeUnknown,
        error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
      },
    }).catch(() => undefined);
    return err(error instanceof AsaasHttpError ? 'ERRO_ASAAS' : 'ERRO_INTERNO');
  }
}
