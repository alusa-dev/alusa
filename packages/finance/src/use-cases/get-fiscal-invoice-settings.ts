import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  type AsaasFiscalInfo,
  configureNationalPortal as asaasConfigureNationalPortal,
  getFiscalInfo as asaasGetFiscalInfo,
  getMunicipalOptions as asaasGetMunicipalOptions,
} from '@alusa/asaas';

import { featureFlagsService } from '../foundation/feature-flags.service';
import { auditLogService } from '../foundation/audit-log.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { computeFiscalReadiness, mapAuthenticationTypeToAccessMethod } from '../fiscal/fiscal-readiness';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';

export type FiscalServiceOutput = {
  id: string;
  name: string;
  municipalServiceCode: string;
  source: string;
  nationalTaxCode: string | null;
  nbsCode: string | null;
  defaultDescription: string | null;
  isDefault: boolean;
  iss: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  retainIss: boolean;
  asaasMunicipalServiceId: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  pisCofinsTaxStatus: string | null;
  operationPis: number | null;
  operationCofins: number | null;
  useTaxSystemReformNT007: boolean;
};

export type FiscalInvoiceSettingsOutput = {
  configured: boolean;
  settings: {
    fiscalEmail: string | null;
    municipalInscription: string | null;
    stateInscription: string | null;
    aedf: string | null;
    simplesNacional: boolean;
    culturalProjectsPromoter: boolean;
    cnae: string | null;
    specialTaxRegime: string | null;
    serviceListItem: string | null;
    nbsCode: string | null;
    rpsSerie: string | null;
    rpsNumber: number | null;
    loteNumber: number | null;
    nationalPortalTaxCalculationRegime: string | null;
    useNationalPortal: boolean | null;
    accessMethod: string | null;
    passwordConfigured: boolean;
    accessTokenConfigured: boolean;
    certificateConfigured: boolean;
    defaultDescriptionTemplate: string | null;
    defaultObservations: string | null;
    defaultDeductions: number | null;
    emissionMode: string;
    invoiceEffectiveDatePeriod: string;
    invoiceDaysBeforeDueDate: number | null;
    invoiceReceivedOnly: boolean;
    readinessStatus: string;
    readinessIssues: unknown;
    syncStatus: string;
    lastSyncError: string | null;
    lastSyncedAt: string | null;
    asaasFiscalSyncedAt: string | null;
  } | null;
  services: FiscalServiceOutput[];
  municipalOptions: unknown | null;
  readiness: {
    status: string;
    ready: boolean;
    issues: Array<{ code: string; message: string; blocking: boolean }>;
  };
};

export type GetFiscalInvoiceSettingsError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_INTERNO';

export type FiscalRemoteSyncMode = 'always' | 'if_stale' | 'never';

const FISCAL_REMOTE_SYNC_TTL_MS = 15 * 60 * 1000;

function shouldSyncRemoteFiscalSettings(
  settings: { asaasFiscalSyncedAt: Date | null } | null,
  mode: FiscalRemoteSyncMode,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  if (!settings?.asaasFiscalSyncedAt) return true;
  return Date.now() - settings.asaasFiscalSyncedAt.getTime() > FISCAL_REMOTE_SYNC_TTL_MS;
}

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  return Number(value);
}

function mapService(service: {
  id: string;
  name: string;
  municipalServiceCode: string;
  source: string;
  nationalTaxCode: string | null;
  nbsCode: string | null;
  defaultDescription: string | null;
  isDefault: boolean;
  iss: unknown;
  pis: unknown;
  cofins: unknown;
  csll: unknown;
  inss: unknown;
  ir: unknown;
  retainIss: boolean;
  asaasMunicipalServiceId: string | null;
  taxSituationCode: string | null;
  taxClassificationCode: string | null;
  operationIndicatorCode: string | null;
  pisCofinsTaxStatus: string | null;
  operationPis: unknown;
  operationCofins: unknown;
  useTaxSystemReformNT007: boolean;
}): FiscalServiceOutput {
  return {
    id: service.id,
    name: service.name,
    municipalServiceCode: service.municipalServiceCode,
    source: service.source,
    nationalTaxCode: service.nationalTaxCode,
    nbsCode: service.nbsCode,
    defaultDescription: service.defaultDescription,
    isDefault: service.isDefault,
    iss: decimalToNumber(service.iss),
    pis: decimalToNumber(service.pis),
    cofins: decimalToNumber(service.cofins),
    csll: decimalToNumber(service.csll),
    inss: decimalToNumber(service.inss),
    ir: decimalToNumber(service.ir),
    retainIss: service.retainIss,
    asaasMunicipalServiceId: service.asaasMunicipalServiceId,
    taxSituationCode: service.taxSituationCode,
    taxClassificationCode: service.taxClassificationCode,
    operationIndicatorCode: service.operationIndicatorCode,
    pisCofinsTaxStatus: service.pisCofinsTaxStatus,
    operationPis: service.operationPis == null ? null : Number(service.operationPis),
    operationCofins: service.operationCofins == null ? null : Number(service.operationCofins),
    useTaxSystemReformNT007: service.useTaxSystemReformNT007,
  };
}

async function upsertRemoteFiscalInfoCache(input: {
  contaId: string;
  remote: AsaasFiscalInfo;
  authenticationType?: string | null;
}) {
  const prisma = getFiscalPrisma();
  const now = new Date();
  const accessMethod = mapAuthenticationTypeToAccessMethod(input.authenticationType);

  await prisma.contaFiscalSettings.upsert({
    where: { contaId: input.contaId },
    create: {
      contaId: input.contaId,
      fiscalEmail: input.remote.email ?? null,
      municipalInscription: input.remote.municipalInscription ?? null,
      stateInscription: input.remote.stateInscription ?? null,
      aedf: input.remote.aedf ?? null,
      simplesNacional: input.remote.simplesNacional ?? false,
      culturalProjectsPromoter: input.remote.culturalProjectsPromoter ?? false,
      cnae: input.remote.cnae ?? null,
      specialTaxRegime: input.remote.specialTaxRegime ?? null,
      serviceListItem: input.remote.serviceListItem ?? null,
      nbsCode: input.remote.nbsCode ?? null,
      rpsSerie: input.remote.rpsSerie ?? null,
      rpsNumber: input.remote.rpsNumber ?? null,
      loteNumber: input.remote.loteNumber ?? null,
      nationalPortalTaxCalculationRegime: input.remote.nationalPortalTaxCalculationRegime ?? null,
      useNationalPortal: input.remote.useNationalPortal ?? null,
      accessMethod,
      accessConfiguredAt:
        input.remote.passwordSent || input.remote.accessTokenSent || input.remote.certificateSent
          ? now
          : null,
      passwordConfigured: input.remote.passwordSent ?? false,
      accessTokenConfigured: input.remote.accessTokenSent ?? false,
      certificateConfigured: input.remote.certificateSent ?? false,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      lastSyncedAt: now,
      asaasFiscalSyncedAt: now,
    },
    update: {
      fiscalEmail: input.remote.email ?? undefined,
      municipalInscription: input.remote.municipalInscription ?? undefined,
      stateInscription: input.remote.stateInscription ?? undefined,
      aedf: input.remote.aedf ?? undefined,
      simplesNacional: input.remote.simplesNacional ?? undefined,
      culturalProjectsPromoter: input.remote.culturalProjectsPromoter ?? undefined,
      cnae: input.remote.cnae ?? undefined,
      specialTaxRegime: input.remote.specialTaxRegime ?? undefined,
      serviceListItem: input.remote.serviceListItem ?? undefined,
      nbsCode: input.remote.nbsCode ?? undefined,
      rpsSerie: input.remote.rpsSerie ?? undefined,
      rpsNumber: input.remote.rpsNumber ?? undefined,
      loteNumber: input.remote.loteNumber ?? undefined,
      nationalPortalTaxCalculationRegime:
        input.remote.nationalPortalTaxCalculationRegime ?? undefined,
      useNationalPortal: input.remote.useNationalPortal ?? undefined,
      accessMethod: accessMethod ?? undefined,
      accessConfiguredAt:
        input.remote.passwordSent || input.remote.accessTokenSent || input.remote.certificateSent
          ? now
          : undefined,
      passwordConfigured: input.remote.passwordSent ?? undefined,
      accessTokenConfigured: input.remote.accessTokenSent ?? undefined,
      certificateConfigured: input.remote.certificateSent ?? undefined,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      lastSyncedAt: now,
      asaasFiscalSyncedAt: now,
    },
  });
}

export async function getFiscalInvoiceSettings(input: {
  contaId: string;
  /** `if_stale` (padrão): evita bater no Asaas a cada leitura de tela. */
  remoteSync?: FiscalRemoteSyncMode;
}): Promise<Result<FiscalInvoiceSettingsOutput, GetFiscalInvoiceSettingsError>> {
  try {
    const prisma = getFiscalPrisma();
    const remoteSync = input.remoteSync ?? 'if_stale';
    let [settings, services, invoicesEnabled, kyc] = await Promise.all([
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findMany({
        where: { contaId: input.contaId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      featureFlagsService.isEnabled(input.contaId, 'enableInvoices'),
      requireKycApproved(input.contaId),
    ]);

    let municipalOptions = null;
    const credentials = await loadAsaasCredentials(input.contaId);
    if (credentials && shouldSyncRemoteFiscalSettings(settings, remoteSync)) {
      try {
        const [options, remote] = await Promise.all([
          asaasGetMunicipalOptions({ apiKey: credentials.apiKey }),
          asaasGetFiscalInfo({ apiKey: credentials.apiKey }).catch(() => null),
        ]);
        municipalOptions = options;
        if (remote) {
          try {
            await upsertRemoteFiscalInfoCache({
              contaId: input.contaId,
              remote,
              authenticationType: options.authenticationType,
            });
            settings = await prisma.contaFiscalSettings.findUnique({
              where: { contaId: input.contaId },
            });
          } catch (cacheError) {
            console.error('[finance][getFiscalInvoiceSettings][remoteCache]', cacheError);
          }
        }
      } catch {
        municipalOptions = null;
      }
    }

    const readiness = municipalOptions
      ? computeFiscalReadiness({
          settings,
          services,
          municipalOptions,
          kycApproved: kyc.success,
          invoicesEnabled,
        })
      : {
          status: settings?.readinessStatus ?? 'NOT_READY',
          ready: settings?.readinessStatus === 'READY',
          issues:
            (Array.isArray(settings?.readinessIssues)
              ? (settings.readinessIssues as Array<{
                  code: string;
                  message: string;
                  blocking: boolean;
                }>)
              : []) ?? [],
        };

    return ok({
      configured: Boolean(settings),
      settings: settings
        ? {
            fiscalEmail: settings.fiscalEmail,
            municipalInscription: settings.municipalInscription,
            stateInscription: settings.stateInscription ?? null,
            aedf: settings.aedf ?? null,
            simplesNacional: settings.simplesNacional,
            culturalProjectsPromoter: settings.culturalProjectsPromoter,
            cnae: settings.cnae,
            specialTaxRegime: settings.specialTaxRegime,
            serviceListItem: settings.serviceListItem,
            nbsCode: settings.nbsCode,
            rpsSerie: settings.rpsSerie,
            rpsNumber: settings.rpsNumber,
            loteNumber: settings.loteNumber,
            nationalPortalTaxCalculationRegime: settings.nationalPortalTaxCalculationRegime,
            useNationalPortal: settings.useNationalPortal,
            accessMethod: settings.accessMethod,
            passwordConfigured: settings.passwordConfigured,
            accessTokenConfigured: settings.accessTokenConfigured,
            certificateConfigured: settings.certificateConfigured,
            defaultDescriptionTemplate: settings.defaultDescriptionTemplate,
            defaultObservations: settings.defaultObservations,
            defaultDeductions: settings.defaultDeductions ? Number(settings.defaultDeductions) : null,
            emissionMode: settings.emissionMode,
            invoiceEffectiveDatePeriod: settings.invoiceEffectiveDatePeriod,
            invoiceDaysBeforeDueDate: settings.invoiceDaysBeforeDueDate,
            invoiceReceivedOnly: settings.invoiceReceivedOnly,
            readinessStatus: settings.readinessStatus,
            readinessIssues: settings.readinessIssues,
            syncStatus: settings.syncStatus,
            lastSyncError: settings.lastSyncError,
            lastSyncedAt: settings.lastSyncedAt?.toISOString() ?? null,
            asaasFiscalSyncedAt: settings.asaasFiscalSyncedAt?.toISOString() ?? null,
          }
        : null,
      services: services.map(mapService),
      municipalOptions,
      readiness: {
        status: readiness.status,
        ready: readiness.ready,
        issues: readiness.issues,
      },
    });
  } catch (error) {
    console.error('[finance][getFiscalInvoiceSettings]', error);
    return err('ERRO_INTERNO');
  }
}

export async function getFiscalMunicipalOptions(input: {
  contaId: string;
}): Promise<Result<unknown, GetFiscalInvoiceSettingsError>> {
  try {
    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    const options = await asaasGetMunicipalOptions({ apiKey: credentials.apiKey });
    return ok({
      ...options,
      suggestedAccessMethod: mapAuthenticationTypeToAccessMethod(options.authenticationType),
    });
  } catch (error) {
    console.error('[finance][getFiscalMunicipalOptions]', error);
    return err('ERRO_INTERNO');
  }
}

export async function syncFiscalSettingsFromProvider(input: {
  contaId: string;
}): Promise<
  Result<
    {
      syncedAt: string;
      readiness: FiscalInvoiceSettingsOutput['readiness'];
      remote: { useNationalPortal: boolean | null; fiscalEmail: string | null };
    },
    GetFiscalInvoiceSettingsError
  >
> {
  try {
    const prisma = getFiscalPrisma();
    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const [remote, options] = await Promise.all([
      asaasGetFiscalInfo({ apiKey: credentials.apiKey }),
      asaasGetMunicipalOptions({ apiKey: credentials.apiKey }).catch(() => null),
    ]);
    const now = new Date();
    const accessMethod = mapAuthenticationTypeToAccessMethod(options?.authenticationType);

    await prisma.contaFiscalSettings.upsert({
      where: { contaId: input.contaId },
      create: {
        contaId: input.contaId,
        fiscalEmail: remote.email ?? null,
        municipalInscription: remote.municipalInscription ?? null,
        stateInscription: remote.stateInscription ?? null,
        aedf: remote.aedf ?? null,
        simplesNacional: remote.simplesNacional ?? false,
        culturalProjectsPromoter: remote.culturalProjectsPromoter ?? false,
        cnae: remote.cnae ?? null,
        specialTaxRegime: remote.specialTaxRegime ?? null,
        serviceListItem: remote.serviceListItem ?? null,
        nbsCode: remote.nbsCode ?? null,
        rpsSerie: remote.rpsSerie ?? null,
        rpsNumber: remote.rpsNumber ?? null,
      loteNumber: remote.loteNumber ?? null,
      nationalPortalTaxCalculationRegime: remote.nationalPortalTaxCalculationRegime ?? null,
      useNationalPortal: remote.useNationalPortal ?? null,
      accessMethod,
        accessConfiguredAt:
          remote.passwordSent || remote.accessTokenSent || remote.certificateSent ? now : null,
      passwordConfigured: remote.passwordSent ?? false,
      accessTokenConfigured: remote.accessTokenSent ?? false,
      certificateConfigured: remote.certificateSent ?? false,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      lastSyncedAt: now,
      asaasFiscalSyncedAt: now,
      },
      update: {
        fiscalEmail: remote.email ?? undefined,
        municipalInscription: remote.municipalInscription ?? undefined,
        stateInscription: remote.stateInscription ?? undefined,
        aedf: remote.aedf ?? undefined,
        simplesNacional: remote.simplesNacional ?? undefined,
        culturalProjectsPromoter: remote.culturalProjectsPromoter ?? undefined,
        cnae: remote.cnae ?? undefined,
        specialTaxRegime: remote.specialTaxRegime ?? undefined,
        serviceListItem: remote.serviceListItem ?? undefined,
        nbsCode: remote.nbsCode ?? undefined,
        rpsSerie: remote.rpsSerie ?? undefined,
        rpsNumber: remote.rpsNumber ?? undefined,
      loteNumber: remote.loteNumber ?? undefined,
      nationalPortalTaxCalculationRegime: remote.nationalPortalTaxCalculationRegime ?? undefined,
      useNationalPortal: remote.useNationalPortal ?? undefined,
      accessMethod: accessMethod ?? undefined,
        accessConfiguredAt:
          remote.passwordSent || remote.accessTokenSent || remote.certificateSent
            ? now
            : undefined,
      passwordConfigured: remote.passwordSent ?? undefined,
      accessTokenConfigured: remote.accessTokenSent ?? undefined,
      certificateConfigured: remote.certificateSent ?? undefined,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      lastSyncedAt: now,
      asaasFiscalSyncedAt: now,
    },
  });

    const [settings, services] = await Promise.all([
      prisma.contaFiscalSettings.findUnique({ where: { contaId: input.contaId } }),
      prisma.fiscalService.findMany({ where: { contaId: input.contaId } }),
    ]);
    const readiness = computeFiscalReadiness({
      settings,
      services,
      municipalOptions: options,
      kycApproved: true,
      invoicesEnabled: true,
    });

    if (settings) {
      await prisma.contaFiscalSettings.update({
        where: { id: settings.id },
        data: {
          readinessStatus: readiness.status,
          readinessIssues: readiness.issues,
        },
      });
    }

    await auditLogService.record({
      contaId: input.contaId,
      actor: { type: 'SYSTEM' },
      action: 'finance.fiscal.settings.synced',
      entity: { type: 'ContaFiscalSettings', id: settings?.id ?? input.contaId },
      metadata: {
        syncedAt: now.toISOString(),
        readinessStatus: readiness.status,
        ready: readiness.ready,
      },
    });

    return ok({
      syncedAt: now.toISOString(),
      readiness: {
        status: readiness.status,
        ready: readiness.ready,
        issues: readiness.issues,
      },
      remote: {
        useNationalPortal: remote.useNationalPortal ?? null,
        fiscalEmail: remote.email ?? null,
      },
    });
  } catch (error) {
    console.error('[finance][syncFiscalSettingsFromProvider]', error);
    await getFiscalPrisma()
      .contaFiscalSettings.update({
        where: { contaId: input.contaId },
        data: {
          syncStatus: 'DIVERGED',
          lastSyncError: error instanceof Error ? error.message.slice(0, 1000) : 'Erro interno',
        },
      })
      .catch(() => undefined);
    return err('ERRO_INTERNO');
  }
}

export async function configureFiscalNationalPortal(input: {
  contaId: string;
  enabled: boolean;
}): Promise<Result<{ success: boolean; useNationalPortal: boolean }, GetFiscalInvoiceSettingsError>> {
  try {
    const prisma = getFiscalPrisma();
    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const result = await asaasConfigureNationalPortal({
      apiKey: credentials.apiKey,
      data: { enabled: input.enabled },
    });

    const now = new Date();
    const settings = await prisma.contaFiscalSettings.upsert({
      where: { contaId: input.contaId },
      create: {
        contaId: input.contaId,
        useNationalPortal: input.enabled,
        syncStatus: 'PENDING',
        lastSyncedAt: now,
        asaasFiscalSyncedAt: now,
      },
      update: {
        useNationalPortal: input.enabled,
        syncStatus: 'PENDING',
        lastSyncError: null,
        lastSyncedAt: now,
        asaasFiscalSyncedAt: now,
      },
      select: { id: true },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: { type: 'SYSTEM' },
      action: 'finance.fiscal.national_portal.configured',
      entity: { type: 'ContaFiscalSettings', id: settings.id },
      metadata: { enabled: input.enabled },
    });

    return ok({ success: result.success ?? true, useNationalPortal: input.enabled });
  } catch (error) {
    console.error('[finance][configureFiscalNationalPortal]', error);
    return err('ERRO_INTERNO');
  }
}
