import type { ContaFiscalSettings, FiscalAccessMethod } from '@prisma/client';
import type { AsaasFiscalInfo, AsaasFiscalMunicipalOptions } from '@alusa/asaas';
import {
  configureNationalPortal as asaasConfigureNationalPortal,
  getFiscalInfo as asaasGetFiscalInfo,
  getMunicipalOptions as asaasGetMunicipalOptions,
  upsertFiscalInfo as asaasUpsertFiscalInfo,
} from '@alusa/asaas';

import { getFiscalPrisma } from './fiscal-prisma';
import { normalizeNbsCodeForAsaas } from './nbs-code';

export type PersistFiscalCoreSettingsInput = {
  contaId: string;
  fiscalEmail: string;
  municipalInscription?: string;
  stateInscription?: string;
  aedf?: string;
  simplesNacional: boolean;
  culturalProjectsPromoter?: boolean;
  cnae?: string;
  specialTaxRegime?: string;
  serviceListItem?: string;
  nbsCode?: string;
  rpsSerie?: string;
  rpsNumber?: number;
  loteNumber?: number;
  nationalPortalTaxCalculationRegime?: string;
  useNationalPortal?: boolean;
  accessMethod?: FiscalAccessMethod;
  username?: string;
  password?: string;
  accessToken?: string;
  certificateFile?: Blob | File;
  certificatePassword?: string;
};

export type PersistFiscalCoreSettingsParams = {
  apiKey: string;
  input: PersistFiscalCoreSettingsInput;
  remoteFiscalInfo: AsaasFiscalInfo | null;
  municipalOptions: AsaasFiscalMunicipalOptions | null;
};

export type PersistFiscalCoreSettingsResult = {
  settings: ContaFiscalSettings;
  municipalOptionsAfterSave: AsaasFiscalMunicipalOptions | null;
  syncedAt: Date;
};

export async function persistFiscalCoreSettings(
  params: PersistFiscalCoreSettingsParams,
): Promise<PersistFiscalCoreSettingsResult> {
  const prisma = getFiscalPrisma();
  const { input, apiKey, remoteFiscalInfo, municipalOptions } = params;
  const now = new Date();

  const hasNewPassword = Boolean(input.password?.trim());
  const hasNewToken = Boolean(input.accessToken?.trim());
  const hasNewCertificate = Boolean(input.certificateFile);
  const useNationalPortalForSave =
    input.useNationalPortal ?? Boolean(remoteFiscalInfo?.useNationalPortal);
  const nationalPortalTaxCalculationRegime = useNationalPortalForSave
    ? input.nationalPortalTaxCalculationRegime
    : undefined;

  await prisma.contaFiscalSettings.upsert({
    where: { contaId: input.contaId },
    create: {
      contaId: input.contaId,
      fiscalEmail: input.fiscalEmail,
      simplesNacional: input.simplesNacional,
      syncStatus: 'PENDING',
      lastSyncError: null,
    },
    update: {
      syncStatus: 'PENDING',
      lastSyncError: null,
    },
  });

  if (typeof input.useNationalPortal === 'boolean') {
    await asaasConfigureNationalPortal({
      apiKey,
      data: { enabled: input.useNationalPortal },
    });
  }

  await asaasUpsertFiscalInfo({
    apiKey,
    data: {
      email: input.fiscalEmail,
      simplesNacional: input.simplesNacional,
      municipalInscription: input.municipalInscription,
      stateInscription: input.stateInscription,
      aedf: input.aedf,
      culturalProjectsPromoter: input.culturalProjectsPromoter,
      cnae: input.cnae,
      specialTaxRegime: input.specialTaxRegime,
      serviceListItem: input.serviceListItem,
      nbsCode: normalizeNbsCodeForAsaas(input.nbsCode),
      rpsSerie: input.rpsSerie,
      rpsNumber: input.rpsNumber,
      loteNumber: input.loteNumber,
      username: input.username,
      password: input.password,
      accessToken: input.accessToken,
      certificateFile: input.certificateFile,
      certificatePassword: input.certificatePassword,
      nationalPortalTaxCalculationRegime,
    },
  });

  const confirmedFiscalInfo = await asaasGetFiscalInfo({ apiKey }).catch(() => null);

  const settings = await prisma.contaFiscalSettings.upsert({
    where: { contaId: input.contaId },
    create: {
      contaId: input.contaId,
      fiscalEmail: input.fiscalEmail,
      municipalInscription: input.municipalInscription ?? null,
      stateInscription: input.stateInscription ?? null,
      aedf: input.aedf ?? null,
      simplesNacional: input.simplesNacional,
      culturalProjectsPromoter: input.culturalProjectsPromoter ?? false,
      cnae: input.cnae ?? null,
      specialTaxRegime: input.specialTaxRegime ?? null,
      serviceListItem: input.serviceListItem ?? null,
      nbsCode: normalizeNbsCodeForAsaas(input.nbsCode) ?? null,
      rpsSerie: input.rpsSerie ?? null,
      rpsNumber: input.rpsNumber ?? null,
      loteNumber: input.loteNumber ?? null,
      nationalPortalTaxCalculationRegime: nationalPortalTaxCalculationRegime ?? null,
      useNationalPortal: confirmedFiscalInfo?.useNationalPortal ?? input.useNationalPortal ?? null,
      accessMethod: input.accessMethod ?? null,
      accessConfiguredAt: input.accessMethod ? now : null,
      passwordConfigured: hasNewPassword,
      accessTokenConfigured: hasNewToken,
      certificateConfigured: hasNewCertificate,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      asaasFiscalSyncedAt: now,
      lastSyncedAt: now,
    },
    update: {
      fiscalEmail: input.fiscalEmail,
      municipalInscription: input.municipalInscription ?? null,
      stateInscription: input.stateInscription ?? null,
      aedf: input.aedf ?? null,
      simplesNacional: input.simplesNacional,
      culturalProjectsPromoter: input.culturalProjectsPromoter ?? false,
      cnae: input.cnae ?? null,
      specialTaxRegime: input.specialTaxRegime ?? null,
      serviceListItem: input.serviceListItem ?? null,
      nbsCode: normalizeNbsCodeForAsaas(input.nbsCode) ?? null,
      rpsSerie: input.rpsSerie ?? null,
      rpsNumber: input.rpsNumber ?? null,
      loteNumber: input.loteNumber ?? null,
      nationalPortalTaxCalculationRegime: nationalPortalTaxCalculationRegime ?? null,
      useNationalPortal:
        confirmedFiscalInfo?.useNationalPortal ?? input.useNationalPortal ?? undefined,
      accessMethod: input.accessMethod ?? undefined,
      accessConfiguredAt: input.accessMethod ? now : undefined,
      passwordConfigured: hasNewPassword ? true : undefined,
      accessTokenConfigured: hasNewToken ? true : undefined,
      certificateConfigured: hasNewCertificate ? true : undefined,
      syncStatus: 'SYNCED',
      lastSyncError: null,
      asaasFiscalSyncedAt: now,
      lastSyncedAt: now,
    },
  });

  let municipalOptionsAfterSave = municipalOptions;
  try {
    if (!municipalOptionsAfterSave) {
      municipalOptionsAfterSave = await asaasGetMunicipalOptions({ apiKey });
    }
  } catch {
    municipalOptionsAfterSave = null;
  }

  return { settings, municipalOptionsAfterSave, syncedAt: now };
}
