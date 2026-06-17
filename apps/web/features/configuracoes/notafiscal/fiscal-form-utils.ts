import type { FiscalSettingsResponseDTO, SaveFiscalSettingsInputDTO } from './dtos';
import { normalizeNbsCodeForAsaas } from '@alusa/finance/fiscal-wizard-client';

export type FiscalFormDraft = SaveFiscalSettingsInputDTO & {
  certificateFile?: File;
};

export type SerializableFiscalFormDraft = Omit<
  FiscalFormDraft,
  'password' | 'accessToken' | 'certificatePassword' | 'certificateFile'
>;

export const DEFAULT_FISCAL_FORM: FiscalFormDraft = {
  fiscalEmail: '',
  simplesNacional: false,
  culturalProjectsPromoter: false,
  useNationalPortal: false,
  emissionMode: 'MANUAL',
  invoiceEffectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION',
  invoiceReceivedOnly: true,
  defaultDescriptionTemplate: 'Serviços educacionais — {aluno} — competência {competencia}',
};

export function settingsToFormDraft(
  settings: NonNullable<FiscalSettingsResponseDTO['settings']>,
): FiscalFormDraft {
  return {
    fiscalEmail: settings.fiscalEmail ?? '',
    municipalInscription: settings.municipalInscription ?? undefined,
    stateInscription: settings.stateInscription ?? undefined,
    aedf: settings.aedf ?? undefined,
    simplesNacional: settings.simplesNacional ?? false,
    culturalProjectsPromoter: settings.culturalProjectsPromoter ?? false,
    cnae: settings.cnae ?? undefined,
    specialTaxRegime: settings.specialTaxRegime ?? undefined,
    serviceListItem: settings.serviceListItem ?? undefined,
    nbsCode: settings.nbsCode ?? undefined,
    rpsSerie: settings.rpsSerie ?? undefined,
    rpsNumber: settings.rpsNumber ?? undefined,
    loteNumber: settings.loteNumber ?? undefined,
    nationalPortalTaxCalculationRegime: settings.nationalPortalTaxCalculationRegime ?? undefined,
    useNationalPortal: settings.useNationalPortal ?? false,
    accessMethod: settings.accessMethod ?? undefined,
    defaultDescriptionTemplate:
      settings.defaultDescriptionTemplate ??
      DEFAULT_FISCAL_FORM.defaultDescriptionTemplate,
    defaultObservations: settings.defaultObservations ?? undefined,
    defaultDeductions: settings.defaultDeductions ?? undefined,
    emissionMode: settings.emissionMode ?? 'MANUAL',
    invoiceEffectiveDatePeriod:
      settings.invoiceEffectiveDatePeriod ?? 'ON_PAYMENT_CONFIRMATION',
    invoiceDaysBeforeDueDate: settings.invoiceDaysBeforeDueDate ?? undefined,
    invoiceReceivedOnly: settings.invoiceReceivedOnly ?? true,
  };
}

export function mergeSerializableDraftWithSettings(
  draft: SerializableFiscalFormDraft,
  settings: FiscalSettingsResponseDTO['settings'] | null | undefined,
): FiscalFormDraft {
  const base = settings ? settingsToFormDraft(settings) : DEFAULT_FISCAL_FORM;
  const merged = { ...base, ...draft };
  return {
    ...merged,
    nbsCode: normalizeNbsCodeForAsaas(merged.nbsCode) ?? merged.nbsCode,
  };
}

/** Formato com pontos — ex.: 14.05.01 (help Asaas / prefeitura). */
export function formatMunicipalInscription(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** Inscrição estadual — alfanumérico, sem máscara rígida entre estados. */
export function formatStateInscription(value: string): string {
  return value.replace(/[^0-9A-Za-z./-]/g, '').slice(0, 20).toUpperCase();
}

/** Código AEDF — numérico ou alfanumérico conforme prefeitura. */
export function formatAedf(value: string): string {
  return value.replace(/[^0-9A-Za-z./-]/g, '').slice(0, 30).toUpperCase();
}

/** CNAE numérico — ex.: 6209100 */
export function formatCnae(value: string): string {
  return value.replace(/\D/g, '').slice(0, 7);
}

/** Série RPS — até 6 caracteres alfanuméricos. */
export function formatRpsSerie(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
}

export function formatDigitsOnly(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

/** Código de serviço municipal — ex.: 08.01.01 */
export function formatMunicipalServiceCode(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 6) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

/** Percentual com até duas casas decimais (0–100). */
export function formatTaxPercent(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [intPart = '', ...rest] = normalized.split('.');
  const decimals = rest.join('').slice(0, 2);
  const integer = intPart.slice(0, 3);
  if (!decimals) return integer;
  return `${integer}.${decimals}`;
}

export function parseTaxPercent(value: string | undefined, fallback = 0): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function labelForSpecialTaxRegime(
  value: string | undefined,
  options?: Array<{ label: string; value: string }>,
): string {
  if (!value) return '—';
  return options?.find((item) => item.value === value)?.label ?? value;
}

export function labelForPortalRegime(
  value: string | undefined,
  options?: Array<{ label: string; value: string }>,
): string {
  if (!value) return '—';
  return options?.find((item) => item.value === value)?.label ?? value;
}

type SubscriptionInvoicePeriod =
  | 'ON_PAYMENT_CONFIRMATION'
  | 'ON_PAYMENT_DUE_DATE'
  | 'BEFORE_PAYMENT_DUE_DATE'
  | 'ON_DUE_DATE_MONTH'
  | 'ON_NEXT_MONTH';

export function getSubscriptionInvoicePeriodExample(input: {
  period?: SubscriptionInvoicePeriod | null;
  daysBeforeDueDate?: number | null;
  receivedOnly?: boolean | null;
}): { label: string; description: string } {
  const period = input.period ?? 'ON_PAYMENT_CONFIRMATION';
  const days = input.daysBeforeDueDate ?? 5;

  switch (period) {
    case 'ON_PAYMENT_DUE_DATE':
      return {
        label: 'Exemplo prático',
        description:
          'Uma mensalidade vence dia 10/03. A NFS-e é emitida automaticamente no dia 10, na data de vencimento, mesmo que o pagamento tenha sido confirmado antes.',
      };
    case 'BEFORE_PAYMENT_DUE_DATE':
      return {
        label: 'Exemplo prático',
        description: `Uma mensalidade vence dia 10/03. Com ${days} dias de antecedência, a NFS-e é emitida automaticamente no dia ${Math.max(1, 10 - days)}/03.`,
      };
    case 'ON_DUE_DATE_MONTH':
      return {
        label: 'Exemplo prático',
        description:
          'Uma mensalidade vence dia 15/03. A NFS-e é emitida automaticamente no 1º dia útil de março, no início do mês do vencimento.',
      };
    case 'ON_NEXT_MONTH':
      return {
        label: 'Exemplo prático',
        description: input.receivedOnly
          ? 'Cobranças recebidas em março têm a NFS-e emitida automaticamente no 1º dia útil de abril, apenas para as que foram pagas no mês anterior.'
          : 'Cobranças com vencimento em março têm a NFS-e emitida automaticamente no 1º dia útil de abril, no mês seguinte.',
      };
    case 'ON_PAYMENT_CONFIRMATION':
    default:
      return {
        label: 'Exemplo prático',
        description:
          'Uma mensalidade vence dia 10/03 e o responsável paga dia 08/03. A NFS-e é emitida automaticamente no dia 08, assim que o pagamento é confirmado.',
      };
  }
}
