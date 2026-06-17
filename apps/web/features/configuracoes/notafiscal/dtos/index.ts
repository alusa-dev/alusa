import { z } from 'zod';
import { PIS_COFINS_TAX_STATUS_VALUES } from '@alusa/finance/fiscal-wizard-client';

export const fiscalAccessMethodSchema = z.enum(['USER_PASSWORD', 'TOKEN', 'CERTIFICATE']);
export const fiscalEmissionModeSchema = z.enum(['MANUAL', 'ON_PAYMENT']);
export const fiscalInvoiceEffectiveDatePeriodSchema = z.enum([
  'ON_PAYMENT_CONFIRMATION',
  'ON_PAYMENT_DUE_DATE',
  'BEFORE_PAYMENT_DUE_DATE',
  'ON_DUE_DATE_MONTH',
  'ON_NEXT_MONTH',
]);
export const fiscalServiceSourceSchema = z.enum(['MUNICIPAL_LIST', 'MANUAL']);

export const fiscalServiceDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  municipalServiceCode: z.string(),
  source: fiscalServiceSourceSchema,
  nationalTaxCode: z.string().nullable(),
  nbsCode: z.string().nullable(),
  defaultDescription: z.string().nullable(),
  isDefault: z.boolean(),
  iss: z.number(),
  pis: z.number(),
  cofins: z.number(),
  csll: z.number(),
  inss: z.number(),
  ir: z.number(),
  retainIss: z.boolean(),
  asaasMunicipalServiceId: z.string().nullable(),
  taxSituationCode: z.string().nullable(),
  taxClassificationCode: z.string().nullable(),
  operationIndicatorCode: z.string().nullable(),
  pisCofinsTaxStatus: z.string().nullable(),
  operationPis: z.number().nullable(),
  operationCofins: z.number().nullable(),
  useTaxSystemReformNT007: z.boolean(),
});

export const fiscalReadinessIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  blocking: z.boolean(),
});

export const fiscalSettingsResponseSchema = z.object({
  configured: z.boolean(),
  settings: z
    .object({
      fiscalEmail: z.string().nullable(),
      municipalInscription: z.string().nullable(),
      stateInscription: z.string().nullable().optional().transform((value) => value ?? null),
      aedf: z.string().nullable().optional().transform((value) => value ?? null),
      simplesNacional: z.boolean(),
      culturalProjectsPromoter: z.boolean(),
      cnae: z.string().nullable(),
      specialTaxRegime: z.string().nullable(),
      serviceListItem: z.string().nullable(),
      nbsCode: z.string().nullable(),
      rpsSerie: z.string().nullable(),
      rpsNumber: z.number().nullable(),
      loteNumber: z.number().nullable(),
      nationalPortalTaxCalculationRegime: z.string().nullable(),
      useNationalPortal: z.boolean().nullable().default(null),
      accessMethod: fiscalAccessMethodSchema.nullable(),
      passwordConfigured: z.boolean(),
      accessTokenConfigured: z.boolean(),
      certificateConfigured: z.boolean(),
      defaultDescriptionTemplate: z.string().nullable(),
      defaultObservations: z.string().nullable(),
      defaultDeductions: z.number().nullable(),
      emissionMode: fiscalEmissionModeSchema,
      invoiceEffectiveDatePeriod: fiscalInvoiceEffectiveDatePeriodSchema.default('ON_PAYMENT_CONFIRMATION'),
      invoiceDaysBeforeDueDate: z.number().nullable().default(null),
      invoiceReceivedOnly: z.boolean().default(true),
      readinessStatus: z.string(),
      readinessIssues: z.unknown().nullable(),
      syncStatus: z.string().default('SYNCED'),
      lastSyncError: z.string().nullable().default(null),
      lastSyncedAt: z.string().nullable(),
      asaasFiscalSyncedAt: z.string().nullable().default(null),
    })
    .nullable(),
  services: z.array(fiscalServiceDTOSchema),
  municipalOptions: z.unknown().nullable(),
  readiness: z.object({
    status: z.string(),
    ready: z.boolean(),
    issues: z.array(fiscalReadinessIssueSchema),
  }),
});

export const saveFiscalSettingsInputSchema = z.object({
  fiscalEmail: z.string().email('E-mail fiscal inválido'),
  municipalInscription: z.string().optional(),
  stateInscription: z.string().optional(),
  aedf: z.string().optional(),
  simplesNacional: z.boolean(),
  culturalProjectsPromoter: z.boolean().optional(),
  cnae: z.string().optional(),
  specialTaxRegime: z.string().optional(),
  serviceListItem: z.string().optional(),
  nbsCode: z.string().optional(),
  rpsSerie: z.string().optional(),
  rpsNumber: z.coerce.number().int().optional(),
  loteNumber: z.coerce.number().int().optional(),
  nationalPortalTaxCalculationRegime: z.string().optional(),
  useNationalPortal: z.boolean().optional(),
  accessMethod: fiscalAccessMethodSchema.optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  accessToken: z.string().optional(),
  certificatePassword: z.string().optional(),
  defaultDescriptionTemplate: z.string().optional(),
  defaultObservations: z.string().optional(),
  defaultDeductions: z.coerce.number().nonnegative().optional(),
  emissionMode: fiscalEmissionModeSchema.optional(),
  invoiceEffectiveDatePeriod: fiscalInvoiceEffectiveDatePeriodSchema.optional(),
  invoiceDaysBeforeDueDate: z.coerce.number().int().refine(
    (value) => [5, 10, 15, 30, 60].includes(value),
    'Informe 5, 10, 15, 30 ou 60 dias.',
  ).optional(),
  invoiceReceivedOnly: z.boolean().optional(),
});

export const fiscalServiceInputSchema = z.object({
  name: z.string().min(1).max(120),
  municipalServiceCode: z.string().max(30).optional(),
  source: fiscalServiceSourceSchema.optional(),
  nationalTaxCode: z.string().max(30).optional(),
  nbsCode: z.string().max(30).optional(),
  defaultDescription: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  iss: z.coerce.number().min(0).max(100).optional(),
  pis: z.coerce.number().min(0).max(100).optional(),
  cofins: z.coerce.number().min(0).max(100).optional(),
  csll: z.coerce.number().min(0).max(100).optional(),
  inss: z.coerce.number().min(0).max(100).optional(),
  ir: z.coerce.number().min(0).max(100).optional(),
  retainIss: z.boolean().optional(),
  asaasMunicipalServiceId: z.string().optional(),
  taxSituationCode: z.string().max(30).optional(),
  taxClassificationCode: z.string().max(30).optional(),
  operationIndicatorCode: z.string().max(30).optional(),
  pisCofinsTaxStatus: z.enum(PIS_COFINS_TAX_STATUS_VALUES).optional(),
  operationPis: z.coerce.number().min(0).max(100).nullable().optional(),
  operationCofins: z.coerce.number().min(0).max(100).nullable().optional(),
  useTaxSystemReformNT007: z.boolean().optional(),
});

export const municipalServicesQuerySchema = z.object({
  description: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const chargeInvoiceResponseSchema = z.object({
  invoice: z
    .object({
      id: z.string(),
      status: z.string(),
      statusDescription: z.string().nullable(),
      errorMessage: z.string().nullable(),
      number: z.string().nullable(),
      pdfUrl: z.string().nullable(),
      xmlUrl: z.string().nullable(),
      serviceDescription: z.string().nullable(),
      observations: z.string().nullable(),
      hasProviderInvoice: z.boolean(),
      effectiveDate: z.string().nullable(),
      scheduledAt: z.string().nullable(),
      statusUpdatedAt: z.string(),
    })
    .nullable(),
  readiness: z.object({
    ready: z.boolean(),
    issues: z.array(fiscalReadinessIssueSchema),
  }),
  municipalOptions: z.object({
    supportsCancellation: z.boolean().nullable(),
  }),
  eligibility: z.object({
    canEmit: z.boolean(),
    canRetry: z.boolean(),
    canCancel: z.boolean(),
    shouldAutoCancel: z.boolean(),
    reason: z.string(),
    message: z.string(),
    severity: z.enum(['success', 'info', 'warning', 'danger']),
  }),
  preview: z
    .object({
      serviceDescription: z.string(),
      observations: z.string(),
      deductions: z.number(),
      effectiveDate: z.string(),
      minEffectiveDate: z.string(),
      value: z.number(),
      municipalServiceName: z.string(),
      municipalServiceCode: z.string().nullable(),
    })
    .optional(),
  syncPending: z.boolean().optional(),
});

export const scheduleChargeInvoiceInputSchema = z.object({
  serviceDescription: z.string().max(2000).optional(),
  observations: z.string().max(2000).optional(),
  deductions: z.coerce.number().nonnegative().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type FiscalSettingsResponseDTO = z.infer<typeof fiscalSettingsResponseSchema>;
export type SaveFiscalSettingsInputDTO = z.infer<typeof saveFiscalSettingsInputSchema>;
export type FiscalServiceInputDTO = z.infer<typeof fiscalServiceInputSchema>;
