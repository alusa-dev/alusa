import { z } from 'zod';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);

const commercialInfoExpirationDTOSchema = z.object({
  isExpired: z.boolean(),
  scheduledDate: dateLikeDTOSchema.nullable(),
});

export const contaFinanceProfileDTOSchema = z
  .object({
    id: z.string(),
    asaasAccountId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    isOnboardingCompleted: z.boolean().optional(),
    onboardingCompletedAt: dateLikeDTOSchema.nullable().optional(),
    lastAsaasSyncAt: dateLikeDTOSchema.nullable().optional(),
    mobilePhone: z.string().nullable().optional(),
    incomeValue: z.union([z.number(), z.string()]).nullable().optional(),
    address: z.string().nullable().optional(),
    addressNumber: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    complement: z.string().nullable().optional(),
    asaasOwnerName: z.string().nullable().optional(),
    asaasCompanyName: z.string().nullable().optional(),
    asaasLoginEmail: z.string().nullable().optional(),
    asaasPhone: z.string().nullable().optional(),
    asaasSite: z.string().nullable().optional(),
    asaasName: z.string().nullable().optional(),
    updatedAt: dateLikeDTOSchema.optional(),
    createdAt: dateLikeDTOSchema.optional(),
    asaasAccount: z
      .object({
        commercialInfoStatus: z.string().nullable().optional(),
        commercialInfoScheduledDate: dateLikeDTOSchema.nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

export type ContaFinanceProfileDTO = z.infer<typeof contaFinanceProfileDTOSchema>;

export const contaMyAccountStatusDTOSchema = z
  .object({
    id: z.string().optional(),
    commercialInfo: z.string().optional(),
    commercialInfoExpiration: commercialInfoExpirationDTOSchema.nullable().optional(),
    bankAccountInfo: z.string().optional(),
    documentation: z.string().optional(),
    general: z.string().optional(),
  })
  .nullable();

export const contaMyAccountDocumentsDTOSchema = z
  .object({
    object: z.string().optional(),
    rejectReasons: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    data: z.array(z.unknown()).default([]),
  })
  .passthrough()
  .nullable();

export const contaFinancialAccountDTOSchema = z.object({
  commercialInfo: z.unknown().nullable(),
  commercialInfoStatus: z.string().nullable(),
  commercialInfoScheduledDate: dateLikeDTOSchema.nullable().optional(),
  commercialInfoExpiration: commercialInfoExpirationDTOSchema.nullable().optional(),
  myAccountStatus: contaMyAccountStatusDTOSchema.optional(),
  documents: contaMyAccountDocumentsDTOSchema.optional(),
  documentsNotReady: z.boolean(),
  retryAfterMs: z.number().nullable().optional(),
});

export type ContaFinancialAccountDTO = z.infer<typeof contaFinancialAccountDTOSchema>;

export const contaFinanceOnboardingResultDTOSchema = z.object({
  data: z.object({
    financeProfile: contaFinanceProfileDTOSchema.nullable(),
    financialAccount: contaFinancialAccountDTOSchema,
  }),
});

export type ContaFinanceOnboardingResultDTO = z.infer<typeof contaFinanceOnboardingResultDTOSchema>;

export const contaFormaPagamentoResponsavelDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string().email(),
});

export type ContaFormaPagamentoResponsavelDTO = z.infer<
  typeof contaFormaPagamentoResponsavelDTOSchema
>;

export const contaFormaPagamentoProximaCobrancaDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  vencimento: z.string(),
  valor: z.number().nullable(),
});

export type ContaFormaPagamentoProximaCobrancaDTO = z.infer<
  typeof contaFormaPagamentoProximaCobrancaDTOSchema
>;

export const contaFormaPagamentoAssinaturaDTOSchema = z.object({
  id: z.string(),
  asaasSubscriptionId: z.string().nullable(),
  aluno: z.string(),
  cpf: z.string().nullable(),
  plano: z.string(),
  status: z.string(),
  formaPagamento: z.string(),
  proximaCobranca: contaFormaPagamentoProximaCobrancaDTOSchema.nullable(),
});

export type ContaFormaPagamentoAssinaturaDTO = z.infer<typeof contaFormaPagamentoAssinaturaDTOSchema>;

export const contaFormaPagamentoResultDTOSchema = z.object({
  responsavel: contaFormaPagamentoResponsavelDTOSchema.nullable(),
  assinaturas: z.array(contaFormaPagamentoAssinaturaDTOSchema),
});

export type ContaFormaPagamentoResultDTO = z.infer<typeof contaFormaPagamentoResultDTOSchema>;

export const contaFormaPagamentoSyncResultDTOSchema = z.object({
  synced: z.boolean(),
  cardSynced: z.boolean().optional(),
  billingTypeSynced: z.boolean().optional(),
  message: z.string().optional(),
  data: z
    .object({
      creditCard: z
        .object({
          brand: z.string(),
          last4: z.string(),
        })
        .nullable(),
      billingType: z.string().nullable(),
    })
    .optional(),
});

export type ContaFormaPagamentoSyncResultDTO = z.infer<typeof contaFormaPagamentoSyncResultDTOSchema>;

export const contaBlockedActionResultDTOSchema = z.object({
  error: z.string(),
});

export type ContaBlockedActionResultDTO = z.infer<typeof contaBlockedActionResultDTOSchema>;

export const closeContaInputDTOSchema = z.object({
  reason: z.string(),
  confirmText: z.string(),
});

export type CloseContaInputDTO = z.input<typeof closeContaInputDTOSchema>;

export const closeContaSuccessResultDTOSchema = z.object({
  result: z.unknown(),
  message: z.string(),
});

export type CloseContaSuccessResultDTO = z.infer<typeof closeContaSuccessResultDTOSchema>;

export const closeContaErrorResultDTOSchema = z.object({
  message: z.string(),
});

export type CloseContaErrorResultDTO = z.infer<typeof closeContaErrorResultDTOSchema>;
