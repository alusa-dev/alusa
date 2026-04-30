import { z } from 'zod';
import { Role } from '@prisma/client';

const nullableStringDTOSchema = z.string().nullable();

export const adminTestCustomerQueryDTOSchema = z.object({
  contaId: z.string().trim().optional(),
});

export type AdminTestCustomerQueryDTO = z.infer<typeof adminTestCustomerQueryDTOSchema>;

export const adminTestCustomerResultDTOSchema = z.object({
  ok: z.boolean(),
  asaasCustomerId: z.string().optional(),
  usedSubaccountId: nullableStringDTOSchema.default(null).optional(),
  usedPayer: z.string().optional(),
  steps: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export type AdminTestCustomerResultDTO = z.infer<typeof adminTestCustomerResultDTOSchema>;

export const adminFinancialHealthCheckDTOSchema = z.object({
  name: z.enum(['base_url', 'credentials', 'webhook', 'feature_flag']),
  ok: z.boolean(),
  message: z.string().optional(),
});

export type AdminFinancialHealthCheckDTO = z.infer<typeof adminFinancialHealthCheckDTOSchema>;

export const adminFinancialHealthResultDTOSchema = z.object({
  ok: z.boolean(),
  overallStatus: z.enum(['OK', 'WARNING', 'ERROR']),
  checks: z.array(adminFinancialHealthCheckDTOSchema),
  queue: z
    .object({
      contaId: z.string(),
      backlog: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      errored: z.number().int().nonnegative(),
      processed: z.number().int().nonnegative(),
      highRetryBacklog: z.number().int().nonnegative(),
      stuckProcessing: z.number().int().nonnegative(),
      oldestPendingAt: nullableStringDTOSchema.default(null),
      lagSeconds: z.number().nullable(),
      generatedAt: z.string(),
    })
    .passthrough(),
  queueStatus: z.enum(['OK', 'DEGRADED', 'WARNING']),
  asaasReads: z
    .object({
      kycCache: z.object({
        status: z.object({
          hits: z.number().int().nonnegative(),
          misses: z.number().int().nonnegative(),
          forceRefreshes: z.number().int().nonnegative(),
        }),
        documents: z.object({
          hits: z.number().int().nonnegative(),
          misses: z.number().int().nonnegative(),
          forceRefreshes: z.number().int().nonnegative(),
        }),
        invalidations: z.number().int().nonnegative(),
      }),
      routeReads: z.object({
        cobrancaDetail: z.object({
          local: z.number().int().nonnegative(),
          remote: z.number().int().nonnegative(),
          freshRemote: z.number().int().nonnegative(),
        }),
        portalFinanceiroDetail: z.object({
          local: z.number().int().nonnegative(),
          remote: z.number().int().nonnegative(),
          freshRemote: z.number().int().nonnegative(),
        }),
        matriculaDetail: z.object({
          local: z.number().int().nonnegative(),
          remote: z.number().int().nonnegative(),
          freshRemote: z.number().int().nonnegative(),
        }),
        paymentMethodSync: z.object({
          local: z.number().int().nonnegative(),
          remote: z.number().int().nonnegative(),
          freshRemote: z.number().int().nonnegative(),
        }),
      }),
      commandPreflight: z.object({
        statusOnly: z.number().int().nonnegative(),
        fullPayment: z.number().int().nonnegative(),
      }),
      intentStats: z.object({
        READ_MODEL: z.number().int().nonnegative(),
        COMMAND_PREFLIGHT_STATUS: z.number().int().nonnegative(),
        COMMAND_PREFLIGHT_FULL: z.number().int().nonnegative(),
        RECONCILIATION: z.number().int().nonnegative(),
        MANUAL_REPAIR: z.number().int().nonnegative(),
        AUTHORITATIVE_DOCUMENT: z.number().int().nonnegative(),
      }),
    })
    .optional(),
});

export type AdminFinancialHealthResultDTO = z.infer<typeof adminFinancialHealthResultDTOSchema>;

export const internalHealthCheckDTOSchema = z.object({
  name: z.string(),
  status: z.enum(['OK', 'WARNING', 'ERROR']),
  message: z.string().optional(),
});

export type InternalHealthCheckDTO = z.infer<typeof internalHealthCheckDTOSchema>;

export const internalHealthResultDTOSchema = z.object({
  ok: z.boolean(),
  overallStatus: z.enum(['OK', 'DEGRADED', 'ERROR']),
  checks: z.array(internalHealthCheckDTOSchema),
});

export type InternalHealthResultDTO = z.infer<typeof internalHealthResultDTOSchema>;

export const appHealthResultDTOSchema = z
  .object({
    ok: z.boolean(),
    now: z.string().nullable().optional(),
    conta: z
      .object({
        id: z.string(),
        nome: z.string(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type AppHealthResultDTO = z.infer<typeof appHealthResultDTOSchema>;

export const devSetPasswordInputDTOSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type DevSetPasswordInputDTO = z.infer<typeof devSetPasswordInputDTOSchema>;

export const devSetPasswordResultDTOSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
});

export type DevSetPasswordResultDTO = z.infer<typeof devSetPasswordResultDTOSchema>;

export const devUserQueryDTOSchema = z.object({
  email: z.string().email(),
});

export type DevUserQueryDTO = z.infer<typeof devUserQueryDTOSchema>;

export const devUserResultDTOSchema = z.object({
  exists: z.boolean(),
  user: z
    .object({
      id: z.string(),
      email: z.string().email(),
      nome: z.string(),
      role: z.string(),
    })
    .optional(),
});

export type DevUserResultDTO = z.infer<typeof devUserResultDTOSchema>;

export const testCreateInviteInputDTOSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role).default(Role.RECEPCAO),
});

export type TestCreateInviteInputDTO = z.infer<typeof testCreateInviteInputDTOSchema>;

export const testCreateInviteResultDTOSchema = z.object({
  token: z.string(),
  email: z.string().email(),
  role: z.string(),
});

export type TestCreateInviteResultDTO = z.infer<typeof testCreateInviteResultDTOSchema>;
