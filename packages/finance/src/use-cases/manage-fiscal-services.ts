import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import {
  listFiscalCodes as asaasListFiscalCodes,
  listMunicipalServices as asaasListMunicipalServices,
  listNbsCodes as asaasListNbsCodes,
  type FiscalCodeKind,
  type AsaasMunicipalService,
  type AsaasNbsCode,
} from '@alusa/asaas';
import type { FiscalServiceSource } from '@prisma/client';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import {
  normalizeOperationPisCofinsRates,
  normalizePisCofinsTaxStatus,
  validatePisCofinsTaxRules,
} from '../fiscal/pis-cofins-tax-status';
import { validateFiscalIbsCbs } from '../fiscal/ibs-cbs';

export type FiscalServiceInput = {
  name: string;
  municipalServiceCode?: string;
  source?: FiscalServiceSource;
  nationalTaxCode?: string;
  nbsCode?: string;
  defaultDescription?: string;
  isDefault?: boolean;
  iss?: number;
  pis?: number;
  cofins?: number;
  csll?: number;
  inss?: number;
  ir?: number;
  retainIss?: boolean;
  asaasMunicipalServiceId?: string;
  taxSituationCode?: string;
  taxClassificationCode?: string;
  operationIndicatorCode?: string;
  pisCofinsTaxStatus?: string;
  operationPis?: number | null;
  operationCofins?: number | null;
  useTaxSystemReformNT007?: boolean;
};

export type ManageFiscalServiceError =
  | 'SERVICO_NAO_ENCONTRADO'
  | 'SERVICO_MUNICIPAL_INVALIDO'
  | 'PIS_COFINS_INVALIDO'
  | 'IBS_CBS_INVALIDO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'FISCAL_CORE_NOT_SYNCED'
  | 'DEFAULT_SERVICE_REQUIRED'
  | 'ERRO_INTERNO';

export type ListMunicipalServicesInput = {
  contaId: string;
  offset?: number;
  limit?: number;
  description?: string;
};

export type ListFiscalReferenceCodesInput = {
  contaId: string;
  kind: FiscalCodeKind;
  offset?: number;
  limit?: number;
  code?: string;
  description?: string;
};

export type ListNbsCodesInput = {
  contaId: string;
  offset?: number;
  limit?: number;
  codeDescription?: string;
};

async function ensureSingleDefault(contaId: string, serviceId: string, isDefault: boolean) {
  if (!isDefault) return;
  const prisma = getFiscalPrisma();
  await prisma.fiscalService.updateMany({
    where: { contaId, id: { not: serviceId } },
    data: { isDefault: false },
  });
}

export async function listFiscalServices(contaId: string) {
  const prisma = getFiscalPrisma();
  return prisma.fiscalService.findMany({
    where: { contaId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

export async function listProviderMunicipalServices(
  input: ListMunicipalServicesInput,
): Promise<Result<{
  data: AsaasMunicipalService[];
  totalCount: number;
  hasMore: boolean;
  portalManualMode: boolean;
}, ManageFiscalServiceError>> {
  try {
    const prisma = getFiscalPrisma();
    const fiscalSettings = await prisma.contaFiscalSettings.findUnique({
      where: { contaId: input.contaId },
      select: { asaasFiscalSyncedAt: true },
    });
    if (!fiscalSettings?.asaasFiscalSyncedAt) {
      return err('FISCAL_CORE_NOT_SYNCED');
    }

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const response = await asaasListMunicipalServices({
      apiKey: credentials.apiKey,
      offset: input.offset,
      limit: input.limit,
      description: input.description,
    });

    return ok({
      data: response.data ?? [],
      totalCount: response.totalCount ?? 0,
      hasMore: response.hasMore ?? false,
      portalManualMode: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const portalManualMode =
      message.toLowerCase().includes('código de serviços municipais') ||
      message.toLowerCase().includes('codigo de servicos municipais');

    if (portalManualMode) {
      return ok({
        data: [],
        totalCount: 0,
        hasMore: false,
        portalManualMode: true,
      });
    }

    console.error('[finance][listProviderMunicipalServices]', error);
    return err('ERRO_INTERNO');
  }
}

export async function listProviderNbsCodes(
  input: ListNbsCodesInput,
): Promise<
  Result<
    {
      data: AsaasNbsCode[];
      totalCount: number;
      hasMore: boolean;
    },
    ManageFiscalServiceError
  >
> {
  try {
    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const response = await asaasListNbsCodes({
      apiKey: credentials.apiKey,
      offset: input.offset,
      limit: input.limit,
      codeDescription: input.codeDescription,
    });

    return ok({
      data: response.data ?? [],
      totalCount: response.totalCount ?? 0,
      hasMore: response.hasMore ?? false,
    });
  } catch (error) {
    console.error('[finance][listProviderNbsCodes]', error);
    return err('ERRO_INTERNO');
  }
}

export async function listFiscalReferenceCodes(input: ListFiscalReferenceCodesInput) {
  try {
    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    const response = await asaasListFiscalCodes({
      apiKey: credentials.apiKey,
      kind: input.kind,
      offset: input.offset,
      limit: input.limit,
      code: input.code,
      description: input.description,
    });

    return ok({
      data: response.data ?? [],
      totalCount: response.totalCount ?? 0,
      hasMore: response.hasMore ?? false,
    });
  } catch (error) {
    console.error('[finance][listFiscalReferenceCodes]', error);
    return err('ERRO_INTERNO');
  }
}

function normalizeServiceInput(input: FiscalServiceInput): FiscalServiceInput & {
  source: FiscalServiceSource;
  municipalServiceCode: string;
} {
  const source: FiscalServiceSource = input.asaasMunicipalServiceId
    ? 'MUNICIPAL_LIST'
    : input.source ?? 'MANUAL';

  return {
    ...input,
    source,
    municipalServiceCode: input.municipalServiceCode?.trim() ?? '',
  };
}

function validateServiceSelection(input: ReturnType<typeof normalizeServiceInput>): boolean {
  if (!input.name.trim()) return false;
  if (input.source === 'MUNICIPAL_LIST') return Boolean(input.asaasMunicipalServiceId?.trim());
  return Boolean(input.municipalServiceCode.trim());
}

async function getServiceValidationContext(contaId: string) {
  const prisma = getFiscalPrisma();
  return prisma.contaFiscalSettings.findUnique({
    where: { contaId },
    select: {
      asaasFiscalSyncedAt: true,
      simplesNacional: true,
      useNationalPortal: true,
    },
  });
}

function hasValidPisCofinsConfiguration(
  service: ReturnType<typeof normalizeServiceInput>,
  context: { simplesNacional: boolean; useNationalPortal: boolean | null },
): boolean {
  return (
    validatePisCofinsTaxRules({
      simplesNacional: context.simplesNacional,
      useNationalPortal: Boolean(context.useNationalPortal),
      pisCofinsTaxStatus: service.pisCofinsTaxStatus,
      pis: service.pis,
      cofins: service.cofins,
      operationPis: service.operationPis,
      operationCofins: service.operationCofins,
    }).length === 0
  );
}

function hasValidIbsCbsConfiguration(
  service: ReturnType<typeof normalizeServiceInput>,
  context: { simplesNacional: boolean },
): boolean {
  return context.simplesNacional || validateFiscalIbsCbs(service).length === 0;
}

export async function createFiscalService(
  contaId: string,
  input: FiscalServiceInput,
): Promise<Result<{ id: string }, ManageFiscalServiceError>> {
  try {
    const settings = await getServiceValidationContext(contaId);
    if (!settings?.asaasFiscalSyncedAt) {
      return err('FISCAL_CORE_NOT_SYNCED');
    }

    const prisma = getFiscalPrisma();
    const normalized = normalizeServiceInput(input);
    if (!validateServiceSelection(normalized)) return err('SERVICO_MUNICIPAL_INVALIDO');
    if (!hasValidPisCofinsConfiguration(normalized, settings)) {
      return err('PIS_COFINS_INVALIDO');
    }
    if (!hasValidIbsCbsConfiguration(normalized, settings)) {
      return err('IBS_CBS_INVALIDO');
    }
    const pisCofinsTaxStatus = normalizePisCofinsTaxStatus(normalized.pisCofinsTaxStatus);
    const operationRates = normalizeOperationPisCofinsRates({
      pisCofinsTaxStatus,
      operationPis: normalized.operationPis,
      operationCofins: normalized.operationCofins,
    });

    const created = await prisma.fiscalService.create({
      data: {
        contaId,
        name: normalized.name,
        municipalServiceCode: normalized.municipalServiceCode,
        source: normalized.source,
        nationalTaxCode: normalized.nationalTaxCode ?? null,
        nbsCode: normalized.nbsCode ?? null,
        defaultDescription: normalized.defaultDescription ?? null,
        isDefault: normalized.isDefault ?? false,
        iss: normalized.iss ?? 0,
        pis: normalized.pis ?? 0,
        cofins: normalized.cofins ?? 0,
        csll: normalized.csll ?? 0,
        inss: normalized.inss ?? 0,
        ir: normalized.ir ?? 0,
        retainIss: normalized.retainIss ?? false,
        asaasMunicipalServiceId: normalized.asaasMunicipalServiceId ?? null,
        taxSituationCode: normalized.taxSituationCode ?? null,
        taxClassificationCode: normalized.taxClassificationCode ?? null,
        operationIndicatorCode: normalized.operationIndicatorCode ?? null,
        pisCofinsTaxStatus,
        operationPis: operationRates.operationPis,
        operationCofins: operationRates.operationCofins,
        // NT-007 is mandatory for Regime Normal; it is not a user-controlled rollout.
        useTaxSystemReformNT007: !settings.simplesNacional,
      },
    });

    if (input.isDefault) {
      await ensureSingleDefault(contaId, created.id, true);
    }

    const count = await prisma.fiscalService.count({ where: { contaId } });
    if (count === 1) {
      await prisma.fiscalService.update({
        where: { id: created.id },
        data: { isDefault: true },
      });
    }

    return ok({ id: created.id });
  } catch (error) {
    console.error('[finance][createFiscalService]', error);
    return err('ERRO_INTERNO');
  }
}

export async function updateFiscalService(
  contaId: string,
  serviceId: string,
  input: FiscalServiceInput,
): Promise<Result<{ id: string }, ManageFiscalServiceError>> {
  try {
    const prisma = getFiscalPrisma();
    const settings = await getServiceValidationContext(contaId);
    const normalized = normalizeServiceInput(input);
    if (!validateServiceSelection(normalized)) return err('SERVICO_MUNICIPAL_INVALIDO');
    if (settings && !hasValidPisCofinsConfiguration(normalized, settings)) {
      return err('PIS_COFINS_INVALIDO');
    }
    if (settings && !hasValidIbsCbsConfiguration(normalized, settings)) {
      return err('IBS_CBS_INVALIDO');
    }
    const pisCofinsTaxStatus = normalizePisCofinsTaxStatus(normalized.pisCofinsTaxStatus);
    const operationRates = normalizeOperationPisCofinsRates({
      pisCofinsTaxStatus,
      operationPis: normalized.operationPis,
      operationCofins: normalized.operationCofins,
    });

    const existing = await prisma.fiscalService.findFirst({
      where: { id: serviceId, contaId },
    });
    if (!existing) return err('SERVICO_NAO_ENCONTRADO');

    const updated = await prisma.fiscalService.update({
      where: { id: serviceId },
      data: {
        name: normalized.name,
        municipalServiceCode: normalized.municipalServiceCode,
        source: normalized.source,
        nationalTaxCode: normalized.nationalTaxCode ?? null,
        nbsCode: normalized.nbsCode ?? null,
        defaultDescription: normalized.defaultDescription ?? null,
        isDefault: normalized.isDefault ?? existing.isDefault,
        iss: normalized.iss ?? 0,
        pis: normalized.pis ?? 0,
        cofins: normalized.cofins ?? 0,
        csll: normalized.csll ?? 0,
        inss: normalized.inss ?? 0,
        ir: normalized.ir ?? 0,
        retainIss: normalized.retainIss ?? false,
        asaasMunicipalServiceId: normalized.asaasMunicipalServiceId ?? null,
        taxSituationCode: normalized.taxSituationCode ?? null,
        taxClassificationCode: normalized.taxClassificationCode ?? null,
        operationIndicatorCode: normalized.operationIndicatorCode ?? null,
        pisCofinsTaxStatus,
        operationPis: operationRates.operationPis,
        operationCofins: operationRates.operationCofins,
        useTaxSystemReformNT007: settings ? !settings.simplesNacional : existing.useTaxSystemReformNT007,
      },
    });

    if (input.isDefault) {
      await ensureSingleDefault(contaId, updated.id, true);
    }

    return ok({ id: updated.id });
  } catch (error) {
    console.error('[finance][updateFiscalService]', error);
    return err('ERRO_INTERNO');
  }
}

export async function deleteFiscalService(
  contaId: string,
  serviceId: string,
): Promise<Result<{ id: string }, ManageFiscalServiceError>> {
  try {
    const prisma = getFiscalPrisma();
    const existing = await prisma.fiscalService.findFirst({
      where: { id: serviceId, contaId },
    });
    if (!existing) return err('SERVICO_NAO_ENCONTRADO');

    await prisma.fiscalService.delete({ where: { id: serviceId } });

    if (existing.isDefault) {
      const next = await prisma.fiscalService.findFirst({
        where: { contaId },
        orderBy: { createdAt: 'asc' },
      });
      if (next) {
        await prisma.fiscalService.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return ok({ id: serviceId });
  } catch (error) {
    console.error('[finance][deleteFiscalService]', error);
    return err('ERRO_INTERNO');
  }
}
