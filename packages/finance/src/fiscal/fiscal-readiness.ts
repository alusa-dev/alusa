import type { FiscalAccessMethod, FiscalReadinessStatus, ContaFiscalSettings, FiscalService } from '@prisma/client';
import type { AsaasFiscalMunicipalOptions } from '@alusa/asaas';
import { validateFiscalIbsCbs } from './ibs-cbs';
import { validateAsaasInvoiceTaxesInput } from './invoice-taxes';

export type FiscalReadinessIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

export type FiscalReadinessResult = {
  status: FiscalReadinessStatus;
  ready: boolean;
  issues: FiscalReadinessIssue[];
};

function hasAccessConfigured(settings: ContaFiscalSettings | null): boolean {
  if (!settings?.accessMethod) return false;
  if (settings.accessMethod === 'USER_PASSWORD') {
    return Boolean(settings.passwordConfigured || settings.accessConfiguredAt);
  }
  if (settings.accessMethod === 'TOKEN') {
    return Boolean(settings.accessTokenConfigured || settings.accessConfiguredAt);
  }
  if (settings.accessMethod === 'CERTIFICATE') {
    return Boolean(settings.certificateConfigured || settings.accessConfiguredAt);
  }
  return false;
}

export function computeFiscalReadiness(input: {
  settings: ContaFiscalSettings | null;
  services: FiscalService[];
  municipalOptions?: AsaasFiscalMunicipalOptions | null;
  kycApproved?: boolean;
  invoicesEnabled?: boolean;
}): FiscalReadinessResult {
  const issues: FiscalReadinessIssue[] = [];
  const { settings, services } = input;

  if (input.invoicesEnabled === false) {
    issues.push({
      code: 'FEATURE_DISABLED',
      message: 'Emissão fiscal não está habilitada para esta conta.',
      blocking: true,
    });
  }

  if (input.kycApproved === false) {
    issues.push({
      code: 'KYC_PENDING',
      message: 'Conclua a verificação financeira antes de emitir notas fiscais.',
      blocking: true,
    });
  }

  if (!settings) {
    issues.push({
      code: 'NOT_CONFIGURED',
      message: 'Configure a emissão fiscal da escola.',
      blocking: true,
    });
    return { status: 'NOT_CONFIGURED', ready: false, issues };
  }

  const hasPartialConfig =
    settings.fiscalEmail ||
    settings.municipalInscription ||
    settings.rpsSerie ||
    settings.rpsNumber != null ||
    services.length > 0 ||
    hasAccessConfigured(settings);

  if (input.municipalOptions === null && hasPartialConfig) {
    issues.push({
      code: 'MUNICIPAL_OPTIONS_UNAVAILABLE',
      message: 'Não foi possível carregar os requisitos da prefeitura. Tente revalidar a configuração fiscal.',
      blocking: true,
    });
  }

  if (!hasAccessConfigured(settings)) {
    issues.push({
      code: 'ACCESS_NOT_CONFIGURED',
      message: 'Configure o acesso à prefeitura.',
      blocking: true,
    });
  }

  if (!settings.fiscalEmail?.trim()) {
    issues.push({
      code: 'FISCAL_EMAIL_REQUIRED',
      message: 'Informe o e-mail fiscal.',
      blocking: true,
    });
  }

  const defaultService = services.find((s) => s.isDefault);
  if (!defaultService) {
    issues.push({
      code: 'DEFAULT_SERVICE_REQUIRED',
      message: 'Cadastre um serviço municipal padrão.',
      blocking: true,
    });
  }

  if (defaultService && !settings.simplesNacional) {
    const pisCofinsIssues = validateAsaasInvoiceTaxesInput({
      simplesNacional: false,
      useNationalPortal: settings.useNationalPortal,
      retainIss: defaultService.retainIss,
      iss: Number(defaultService.iss),
      pis: Number(defaultService.pis),
      cofins: Number(defaultService.cofins),
      csll: Number(defaultService.csll),
      inss: Number(defaultService.inss),
      ir: Number(defaultService.ir),
      pisCofinsTaxStatus: defaultService.pisCofinsTaxStatus,
      operationPis: defaultService.operationPis == null ? null : Number(defaultService.operationPis),
      operationCofins:
        defaultService.operationCofins == null ? null : Number(defaultService.operationCofins),
    });
    if (pisCofinsIssues.length > 0) {
      issues.push({
        code: 'PIS_COFINS_NT007_REQUIRED',
        message: pisCofinsIssues[0]!.message,
        blocking: true,
      });
    }

    if (validateFiscalIbsCbs(defaultService).length > 0) {
      issues.push({
        code: 'IBS_CBS_REQUIRED',
        message: 'Complete NBS e os códigos nacionais de IBS/CBS no serviço fiscal padrão.',
        blocking: true,
      });
    }
  }

  if (input.municipalOptions?.usesServiceListItem && !settings.serviceListItem?.trim()) {
    issues.push({
      code: 'SERVICE_LIST_ITEM_REQUIRED',
      message: 'Informe o item da lista de serviço exigido pela prefeitura.',
      blocking: true,
    });
  }

  if (input.municipalOptions?.usesStateInscription && !settings.stateInscription?.trim()) {
    issues.push({
      code: 'STATE_INSCRIPTION_REQUIRED',
      message: 'Informe a inscrição estadual exigida pela prefeitura.',
      blocking: true,
    });
  }

  if (input.municipalOptions?.usesAedf && !settings.aedf?.trim()) {
    issues.push({
      code: 'AEDF_REQUIRED',
      message: 'Informe o código AEDF exigido pela prefeitura.',
      blocking: true,
    });
  }

  if (input.municipalOptions?.usesSpecialTaxRegimes && !settings.specialTaxRegime?.trim()) {
    issues.push({
      code: 'SPECIAL_TAX_REGIME_REQUIRED',
      message: 'Informe o regime especial de tributação.',
      blocking: true,
    });
  }

  if (!settings.municipalInscription?.trim()) {
    issues.push({
      code: 'MUNICIPAL_INSCRIPTION_REQUIRED',
      message: 'Informe a inscrição municipal.',
      blocking: true,
    });
  }

  if (!settings.rpsSerie?.trim()) {
    issues.push({
      code: 'RPS_SERIE_REQUIRED',
      message: 'Informe a série RPS.',
      blocking: true,
    });
  }

  if (settings.rpsNumber == null) {
    issues.push({
      code: 'RPS_NUMBER_REQUIRED',
      message: 'Informe o próximo número de RPS.',
      blocking: true,
    });
  }

  if (input.municipalOptions?.usesNbs && !settings.nbsCode?.trim()) {
    issues.push({
      code: 'NBS_CODE_REQUIRED',
      message: 'Informe o código NBS exigido para emissão.',
      blocking: true,
    });
  }

  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length === 0) {
    return { status: 'READY', ready: true, issues };
  }

  const hasOnlyPartial = hasPartialConfig;
  return {
    status: hasOnlyPartial ? 'PENDING' : 'NOT_CONFIGURED',
    ready: false,
    issues,
  };
}

export function mapAuthenticationTypeToAccessMethod(
  authType?: string | null,
): FiscalAccessMethod | null {
  if (authType === 'USER_AND_PASSWORD') return 'USER_PASSWORD';
  if (authType === 'TOKEN') return 'TOKEN';
  if (authType === 'CERTIFICATE') return 'CERTIFICATE';
  return null;
}
