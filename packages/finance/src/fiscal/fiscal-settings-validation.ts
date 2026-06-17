import type { AsaasFiscalMunicipalOptions } from '@alusa/asaas';

import { isValidNbsCodeFormat, normalizeNbsCodeForAsaas } from './nbs-code';
import type { FiscalAccessMethod, FiscalInvoiceEffectiveDatePeriod } from '@prisma/client';

export type FiscalWizardStepId =
  | 'prefeitura'
  | 'informacoes'
  | 'servico'
  | 'padroes';

export const FISCAL_WIZARD_STEP_LABELS: Record<FiscalWizardStepId, string> = {
  prefeitura: 'Emissor e acesso',
  informacoes: 'Informações fiscais',
  servico: 'Serviço',
  padroes: 'Automação',
};

export type FiscalSettingsDraft = {
  fiscalEmail?: string;
  municipalInscription?: string;
  stateInscription?: string;
  aedf?: string;
  simplesNacional?: boolean;
  specialTaxRegime?: string;
  serviceListItem?: string;
  nbsCode?: string;
  rpsSerie?: string;
  rpsNumber?: number;
  nationalPortalTaxCalculationRegime?: string;
  accessMethod?: FiscalAccessMethod | null;
  username?: string;
  password?: string;
  accessToken?: string;
  certificateFile?: Blob | File;
  certificatePassword?: string;
  useNationalPortal?: boolean;
  emissionMode?: 'MANUAL' | 'ON_PAYMENT';
  invoiceEffectiveDatePeriod?: FiscalInvoiceEffectiveDatePeriod;
  invoiceDaysBeforeDueDate?: number;
  invoiceReceivedOnly?: boolean;
};

export type FiscalSettingsValidationIssue = {
  step: FiscalWizardStepId;
  field: string;
  label: string;
  message: string;
};

export type FiscalSettingsValidationContext = {
  municipalOptions?: AsaasFiscalMunicipalOptions | null;
  passwordConfigured?: boolean;
  accessTokenConfigured?: boolean;
  certificateConfigured?: boolean;
  defaultServiceExists?: boolean;
  useNationalPortal?: boolean;
};

function trim(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function hasCredential(input: {
  password?: string;
  accessToken?: string;
  certificateFile?: Blob | File;
}): boolean {
  return Boolean(
    trim(input.password) || trim(input.accessToken) || input.certificateFile,
  );
}

function resolveAccessMethod(
  draft: FiscalSettingsDraft,
  municipalOptions?: AsaasFiscalMunicipalOptions | null,
): FiscalAccessMethod | null {
  if (draft.accessMethod) return draft.accessMethod;
  const authType = municipalOptions?.authenticationType;
  if (authType === 'USER_AND_PASSWORD') return 'USER_PASSWORD';
  if (authType === 'TOKEN') return 'TOKEN';
  if (authType === 'CERTIFICATE') return 'CERTIFICATE';
  return null;
}

function usesNbs(municipalOptions?: AsaasFiscalMunicipalOptions | null): boolean {
  return Boolean(municipalOptions?.usesNbs);
}

function usesNationalPortal(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext,
): boolean {
  return draft.useNationalPortal ?? context.useNationalPortal ?? false;
}

function issuerName(useNationalPortal: boolean): string {
  return useNationalPortal ? 'Portal Nacional da NFS-e' : 'prefeitura municipal';
}

function issuerAccessTarget(useNationalPortal: boolean): string {
  return useNationalPortal ? 'Portal Nacional da NFS-e' : 'portal da prefeitura municipal';
}

function validateNationalPortalRpsSerie(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext,
): FiscalSettingsValidationIssue[] {
  if (!usesNationalPortal(draft, context)) return [];

  const accessMethod = resolveAccessMethod(draft, context.municipalOptions);
  const serie = trim(draft.rpsSerie);
  if (!serie) return [];
  if (accessMethod !== 'CERTIFICATE' && accessMethod !== 'USER_PASSWORD') return [];

  const number = Number(serie);
  const validNumericSerie = /^\d{5}$/.test(serie);
  const validForCertificate = validNumericSerie && number >= 1 && number <= 49999;
  const validForUserPassword = validNumericSerie && number >= 80000 && number <= 89999;

  if (accessMethod === 'CERTIFICATE' && !validForCertificate) {
    return [
      {
        step: 'informacoes',
        field: 'rpsSerie',
        label: 'Série RPS',
        message:
          'Para NFS-e pelo Portal Nacional com certificado digital, a série RPS deve estar entre 00001 e 49999.',
      },
    ];
  }

  if (accessMethod === 'USER_PASSWORD' && !validForUserPassword) {
    return [
      {
        step: 'informacoes',
        field: 'rpsSerie',
        label: 'Série RPS',
        message:
          'Para NFS-e pelo Portal Nacional com usuário e senha, a série RPS deve estar entre 80000 e 89999.',
      },
    ];
  }

  return [];
}

export function validateFiscalWizardStep(
  step: FiscalWizardStepId,
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext = {},
): FiscalSettingsValidationIssue[] {
  switch (step) {
    case 'prefeitura':
      return validatePrefeituraStep(draft, context);
    case 'informacoes':
      return validateInformacoesStep(draft, context);
    case 'servico':
      return validateServicoStep(context);
    case 'padroes':
      return validatePadroesStep(draft);
    default:
      return [];
  }
}

function validatePadroesStep(draft: FiscalSettingsDraft): FiscalSettingsValidationIssue[] {
  const issues: FiscalSettingsValidationIssue[] = [];
  if (draft.emissionMode !== 'ON_PAYMENT') return issues;

  if (
    draft.invoiceEffectiveDatePeriod === 'BEFORE_PAYMENT_DUE_DATE' &&
    ![5, 10, 15, 30, 60].includes(draft.invoiceDaysBeforeDueDate ?? 0)
  ) {
    issues.push({
      step: 'padroes',
      field: 'invoiceDaysBeforeDueDate',
      label: 'Dias antes do vencimento',
      message: 'Informe 5, 10, 15, 30 ou 60 dias antes do vencimento.',
    });
  }

  return issues;
}

/** Passos 1–2 da doc Asaas: municipalOptions + fiscalInfo (sem serviço padrão). */
export function validateFiscalCoreSettingsDraft(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext = {},
): FiscalSettingsValidationIssue[] {
  return (['prefeitura', 'informacoes'] as FiscalWizardStepId[]).flatMap((step) =>
    validateFiscalWizardStep(step, draft, context),
  );
}

export function validateFiscalSettingsDraft(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext = {},
): FiscalSettingsValidationIssue[] {
  return (
    [
      'prefeitura',
      'informacoes',
      'servico',
      'padroes',
    ] as FiscalWizardStepId[]
  ).flatMap((step) => validateFiscalWizardStep(step, draft, context));
}

function validatePrefeituraStep(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext,
): FiscalSettingsValidationIssue[] {
  const issues: FiscalSettingsValidationIssue[] = [];
  const accessMethod = resolveAccessMethod(draft, context.municipalOptions);
  const useNationalPortal = usesNationalPortal(draft, context);
  const issuer = issuerName(useNationalPortal);
  const accessTarget = issuerAccessTarget(useNationalPortal);

  if (context.municipalOptions === null) {
    issues.push({
      step: 'prefeitura',
      field: 'municipalOptions',
      label: 'Emissor e acesso',
      message:
        'Não foi possível carregar os requisitos fiscais do emissor. Tente revalidar antes de continuar.',
    });
  }

  if (!trim(draft.fiscalEmail)) {
    issues.push({
      step: 'prefeitura',
      field: 'fiscalEmail',
      label: 'E-mail fiscal',
      message: 'Informe o e-mail fiscal para alertas de emissão.',
    });
  }

  if (accessMethod === 'USER_PASSWORD') {
    if (!trim(draft.username)) {
      issues.push({
        step: 'prefeitura',
        field: 'username',
        label: 'Usuário de acesso',
        message: `Informe o usuário de acesso ao ${accessTarget}.`,
      });
    }
    if (!context.passwordConfigured && !trim(draft.password)) {
      issues.push({
        step: 'prefeitura',
        field: 'password',
        label: 'Senha de acesso',
        message: `Informe a senha de acesso ao ${accessTarget}.`,
      });
    }
  }

  if (accessMethod === 'TOKEN') {
    if (!context.accessTokenConfigured && !trim(draft.accessToken)) {
      issues.push({
        step: 'prefeitura',
        field: 'accessToken',
        label: 'Token de acesso',
        message: `Informe o token exigido pelo emissor: ${issuer}.`,
      });
    }
  }

  if (accessMethod === 'CERTIFICATE') {
    if (!context.certificateConfigured && !draft.certificateFile) {
      issues.push({
        step: 'prefeitura',
        field: 'certificateFile',
        label: 'Certificado digital',
        message: `Envie o certificado digital A1 exigido pelo emissor: ${issuer}.`,
      });
    }
    if (draft.certificateFile && !trim(draft.certificatePassword)) {
      issues.push({
        step: 'prefeitura',
        field: 'certificatePassword',
        label: 'Senha do certificado',
        message: 'Informe a senha do certificado digital.',
      });
    }
  }

  if (!accessMethod && !hasCredential(draft)) {
    issues.push({
      step: 'prefeitura',
      field: 'accessMethod',
      label: 'Acesso ao emissor',
      message: `Configure a autenticação exigida pelo emissor: ${issuer}.`,
    });
  }

  return issues;
}

function validateInformacoesStep(
  draft: FiscalSettingsDraft,
  context: FiscalSettingsValidationContext,
): FiscalSettingsValidationIssue[] {
  const issues: FiscalSettingsValidationIssue[] = [];
  const { municipalOptions } = context;

  if (!trim(draft.municipalInscription)) {
    issues.push({
      step: 'informacoes',
      field: 'municipalInscription',
      label: 'Inscrição municipal',
      message: 'Informe a inscrição municipal da empresa.',
    });
  }

  if (!trim(draft.rpsSerie)) {
    issues.push({
      step: 'informacoes',
      field: 'rpsSerie',
      label: 'Série RPS',
      message: 'Informe a série RPS utilizada na emissão.',
    });
  } else if (trim(draft.rpsSerie).length > 6) {
    issues.push({
      step: 'informacoes',
      field: 'rpsSerie',
      label: 'Série RPS',
      message: 'A série RPS deve ter no máximo 6 caracteres.',
    });
  }

  issues.push(...validateNationalPortalRpsSerie(draft, context));

  if (draft.rpsNumber == null || Number.isNaN(draft.rpsNumber)) {
    issues.push({
      step: 'informacoes',
      field: 'rpsNumber',
      label: 'Próximo RPS',
      message: 'Informe o próximo número de RPS.',
    });
  } else if (!Number.isInteger(draft.rpsNumber) || draft.rpsNumber < 1) {
    issues.push({
      step: 'informacoes',
      field: 'rpsNumber',
      label: 'Próximo RPS',
      message: 'O número de RPS deve ser um inteiro maior ou igual a 1.',
    });
  } else if (String(draft.rpsNumber).length > 9) {
    issues.push({
      step: 'informacoes',
      field: 'rpsNumber',
      label: 'Próximo RPS',
      message: 'O número de RPS deve ter no máximo 9 dígitos.',
    });
  }

  if (municipalOptions?.usesSpecialTaxRegimes && trim(draft.specialTaxRegime) === '') {
    issues.push({
      step: 'informacoes',
      field: 'specialTaxRegime',
      label: 'Regime especial de tributação',
      message: 'Selecione o regime especial exigido pela prefeitura (use 0 para Nenhum).',
    });
  }

  if (municipalOptions?.usesServiceListItem && !trim(draft.serviceListItem)) {
    issues.push({
      step: 'informacoes',
      field: 'serviceListItem',
      label: 'Item da lista de serviço',
      message: 'Informe o item da lista de serviço exigido pela prefeitura.',
    });
  }

  if (municipalOptions?.usesStateInscription && !trim(draft.stateInscription)) {
    issues.push({
      step: 'informacoes',
      field: 'stateInscription',
      label: 'Inscrição estadual',
      message:
        municipalOptions.stateInscriptionHelp?.trim() ||
        'Informe a inscrição estadual exigida pela prefeitura.',
    });
  }

  if (municipalOptions?.usesAedf && !trim(draft.aedf)) {
    issues.push({
      step: 'informacoes',
      field: 'aedf',
      label: 'AEDF',
      message:
        municipalOptions.aedfHelp?.trim() ||
        'Informe o código AEDF (Autorização Eletrônica de Documentos Fiscais) exigido pela prefeitura.',
    });
  }

  if (usesNbs(municipalOptions)) {
    const normalized = normalizeNbsCodeForAsaas(draft.nbsCode);
    if (!normalized || !isValidNbsCodeFormat(normalized)) {
      issues.push({
        step: 'informacoes',
        field: 'nbsCode',
        label: 'NBS',
        message: trim(draft.nbsCode)
          ? 'Código NBS inválido. Use o formato 1.0000.00.00 ou selecione um código da lista.'
          : 'Informe o código NBS exigido para emissão.',
      });
    }
  }

  if (
    usesNationalPortal(draft, context) &&
    draft.simplesNacional &&
    (municipalOptions?.nationalPortalTaxCalculationRegimeList?.length ?? 0) > 0 &&
    trim(draft.nationalPortalTaxCalculationRegime) === ''
  ) {
    issues.push({
      step: 'informacoes',
      field: 'nationalPortalTaxCalculationRegime',
      label: 'Regime Portal Nacional',
      message: 'Informe o regime de apuração tributária do Portal Nacional.',
    });
  }

  return issues;
}

function validateServicoStep(context: FiscalSettingsValidationContext): FiscalSettingsValidationIssue[] {
  if (context.defaultServiceExists) return [];
  return [
    {
      step: 'servico',
      field: 'defaultService',
      label: 'Serviço fiscal padrão',
      message: 'Cadastre ao menos um serviço municipal e marque um como padrão.',
    },
  ];
}

export function inferFiscalWizardStepFromAsaasMessage(message: string): FiscalWizardStepId {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('senha') ||
    normalized.includes('usuário') ||
    normalized.includes('usuario') ||
    normalized.includes('token') ||
    normalized.includes('certificado')
  ) {
    return 'prefeitura';
  }
  if (normalized.includes('serviço') || normalized.includes('servico')) {
    return 'servico';
  }
  return 'informacoes';
}
