import { z } from 'zod';

/**
 * Job endpoints accept query strings from both Vercel Cron and operators.
 * Invalid numeric values historically fell back to the documented defaults;
 * keep that compatibility while making the boundary explicit and bounded.
 */
const optionalContaIdDTOSchema = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

function positiveIntWithFallbackDTOSchema(fallback: number, max: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === '') return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.max(1, Math.min(max, Math.trunc(parsed)))
        : fallback;
    },
    z.number().int().min(1).max(max),
  );
}

export const autoCloseAgendaEventsJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
});

export const encerrarContratosJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  maxAccounts: positiveIntWithFallbackDTOSchema(25, 100),
});

export const closeExpiredEnrollmentsJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  limit: positiveIntWithFallbackDTOSchema(100, 500),
  now: z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.string().trim().optional(),
  ),
});

export const expireContractLinksJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  maxAccounts: positiveIntWithFallbackDTOSchema(100, 100),
  limit: positiveIntWithFallbackDTOSchema(500, 500),
});

export const notifyContractsExpiringJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
});

export const processOverdueBillingNotificationsJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  limit: positiveIntWithFallbackDTOSchema(200, 500),
});

export const reconcileFiscalSettingsJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  maxAccounts: positiveIntWithFallbackDTOSchema(20, 50),
});

export const reconcileMatriculaCancellationsJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  maxAccounts: positiveIntWithFallbackDTOSchema(25, 100),
  limit: positiveIntWithFallbackDTOSchema(50, 200),
});

export const reconcileOpenTransfersJobQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  limit: positiveIntWithFallbackDTOSchema(20, 100),
  maxAccounts: positiveIntWithFallbackDTOSchema(30, 200),
  minAgeSeconds: positiveIntWithFallbackDTOSchema(30, 24 * 60 * 60),
});

export const renewalJobsQueryDTOSchema = z.object({
  contaId: optionalContaIdDTOSchema,
  maxAccounts: positiveIntWithFallbackDTOSchema(25, 100),
  limit: positiveIntWithFallbackDTOSchema(25, 100),
});

export type AutoCloseAgendaEventsJobQueryDTO = z.infer<
  typeof autoCloseAgendaEventsJobQueryDTOSchema
>;
export type EncerrarContratosJobQueryDTO = z.infer<typeof encerrarContratosJobQueryDTOSchema>;
export type CloseExpiredEnrollmentsJobQueryDTO = z.infer<
  typeof closeExpiredEnrollmentsJobQueryDTOSchema
>;
export type ExpireContractLinksJobQueryDTO = z.infer<typeof expireContractLinksJobQueryDTOSchema>;
export type NotifyContractsExpiringJobQueryDTO = z.infer<
  typeof notifyContractsExpiringJobQueryDTOSchema
>;
export type ProcessOverdueBillingNotificationsJobQueryDTO = z.infer<
  typeof processOverdueBillingNotificationsJobQueryDTOSchema
>;
export type ReconcileFiscalSettingsJobQueryDTO = z.infer<
  typeof reconcileFiscalSettingsJobQueryDTOSchema
>;
export type ReconcileMatriculaCancellationsJobQueryDTO = z.infer<
  typeof reconcileMatriculaCancellationsJobQueryDTOSchema
>;
export type ReconcileOpenTransfersJobQueryDTO = z.infer<
  typeof reconcileOpenTransfersJobQueryDTOSchema
>;
export type RenewalJobsQueryDTO = z.infer<typeof renewalJobsQueryDTOSchema>;
