import { z } from 'zod';

import {
  EVENT_COSTUME_ASSIGNMENT_STATUSES,
  EVENT_COSTUME_CATEGORIES,
  EVENT_FINANCIAL_ENTRY_STATUSES,
  EVENT_FINANCIAL_ENTRY_TYPES,
  EVENT_PAYMENT_METHODS,
  EVENT_TICKET_MODES,
  EVENT_TICKET_LOT_STATUSES,
  EVENT_TICKET_SALE_STATUSES,
  EVENT_TICKET_TYPES,
  SCHOOL_EVENT_STATUSES,
  SCHOOL_EVENT_TYPES,
} from '@alusa/shared';
import { EVENT_PAYMENT_RULE_TYPES } from './events-payment-rules';
import { calculateEventParticipantDiscount } from './event-participant-discount';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(4000).optional().nullable(),
);

const requiredText = (message: string, max = 255) =>
  z.string({ required_error: message }).trim().min(1, message).max(max);

const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional().nullable());
const requiredDate = z.coerce.date();
const optionalId = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable());

const moneySchema = z.coerce.number().finite().min(0);
const participantDiscountTypeSchema = z.enum(['FIXED', 'PERCENTAGE']);
const positiveIntSchema = z.coerce.number().int().positive();
const eventCostumeAssignmentBillingModes = [
  'INCLUDED_IN_REGISTRATION_FEE',
  'SEPARATE_CHARGE',
  'FREE',
] as const;

const eventPaymentRulesSchema = z.object({
  interestPercent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().finite().min(0).max(5).optional().nullable(),
  ),
  fine: z
    .object({
      value: z.coerce.number().finite().min(0).max(1000000),
      type: z.enum(EVENT_PAYMENT_RULE_TYPES),
    })
    .optional()
    .nullable(),
  discount: z
    .object({
      value: z.coerce.number().finite().min(0).max(1000000),
      type: z.enum(EVENT_PAYMENT_RULE_TYPES),
      dueDateLimitDays: z.coerce.number().int().min(0).max(30),
    })
    .optional()
    .nullable(),
});

export const eventIdSchema = z.string().trim().min(1);

export const listSchoolEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().optional(),
  status: z.enum(SCHOOL_EVENT_STATUSES).optional(),
  type: z.enum(SCHOOL_EVENT_TYPES).optional(),
  responsibleUserId: z.string().trim().optional(),
  fromDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  toDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  hasTickets: z.coerce.boolean().optional(),
  hasCostumes: z.coerce.boolean().optional(),
  hasFinancialControl: z.coerce.boolean().optional(),
});

const schoolEventBaseSchema = z
  .object({
    name: requiredText('Informe o nome do evento.'),
    description: optionalText,
    type: z.enum(SCHOOL_EVENT_TYPES),
    status: z.enum(SCHOOL_EVENT_STATUSES).optional().default('ACTIVE'),
    startsAt: requiredDate,
    endsAt: optionalDate,
    locationName: optionalText,
    locationAddress: optionalText,
    estimatedCapacity: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional().nullable()),
    responsibleUserId: optionalId,
    hasTickets: z.coerce.boolean().optional().default(false),
    ticketMode: z.enum(EVENT_TICKET_MODES).optional().default('NONE'),
    hasCostumes: z.coerce.boolean().optional().default(false),
    hasFinancialControl: z.coerce.boolean().optional().default(true),
    registrationFee: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
    paymentRules: eventPaymentRulesSchema.optional().nullable(),
    contratoModeloId: optionalId,
    notes: optionalText,
  });

export const createSchoolEventSchema = schoolEventBaseSchema.refine(
  (input) => !input.endsAt || input.endsAt.getTime() > input.startsAt.getTime(),
  {
    path: ['endsAt'],
    message: 'A data final precisa ser posterior ao início.',
  },
);

export const updateSchoolEventSchema = schoolEventBaseSchema
  .partial()
  .refine(
    (input) =>
      !input.startsAt ||
      !input.endsAt ||
      input.endsAt.getTime() > input.startsAt.getTime(),
    {
      path: ['endsAt'],
      message: 'A data final precisa ser posterior ao início.',
    },
  );

export const updateSchoolEventStatusSchema = z.object({
  status: z.enum(SCHOOL_EVENT_STATUSES),
});

export const listByEventQuerySchema = z.object({
  eventId: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const ticketLotBaseSchema = z
  .object({
    eventId: eventIdSchema,
    name: requiredText('Informe o nome do lote.'),
    ticketType: z.enum(EVENT_TICKET_TYPES),
    unitPrice: moneySchema,
    quantityTotal: z.coerce.number().int().nonnegative().optional(),
    saleStartsAt: optionalDate,
    saleEndsAt: optionalDate,
    status: z.enum(EVENT_TICKET_LOT_STATUSES).optional().default('DRAFT'),
    notes: optionalText,
  });

export const createTicketLotSchema = ticketLotBaseSchema.refine(
  (input) => !input.saleEndsAt || !input.saleStartsAt || input.saleEndsAt > input.saleStartsAt,
  {
    path: ['saleEndsAt'],
    message: 'O fim das vendas precisa ser posterior ao início.',
  },
);

export const updateTicketLotSchema = ticketLotBaseSchema
  .omit({ eventId: true })
  .partial()
  .refine(
    (input) =>
      !input.saleEndsAt || !input.saleStartsAt || input.saleEndsAt > input.saleStartsAt,
    {
      path: ['saleEndsAt'],
      message: 'O fim das vendas precisa ser posterior ao início.',
    },
  );

export const createTicketSaleSchema = z
  .object({
    eventId: eventIdSchema,
    lotId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    buyerName: requiredText('Informe o comprador.'),
    alunoId: optionalId,
    responsavelId: optionalId,
    quantity: z.preprocess(emptyToUndefined, positiveIntSchema.optional()),
    paymentMethod: z.enum(EVENT_PAYMENT_METHODS),
    status: z.enum(EVENT_TICKET_SALE_STATUSES).optional().default('PENDING'),
    soldAt: optionalDate,
    notes: optionalText,
    holdToken: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  })
  .superRefine((input, ctx) => {
    if (input.holdToken) return;
    if (!input.lotId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Selecione o lote.', path: ['lotId'] });
    }
    if (!input.quantity || input.quantity < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe a quantidade.', path: ['quantity'] });
    }
  });

export const updateTicketSaleSchema = z.object({
  lotId: z.string().trim().min(1).optional(),
  buyerName: z.string().trim().min(1, 'Informe o comprador.').optional(),
  alunoId: optionalId.nullable().optional(),
  responsavelId: optionalId.nullable().optional(),
  quantity: positiveIntSchema.optional(),
  paymentMethod: z.enum(EVENT_PAYMENT_METHODS).optional(),
  status: z.enum(EVENT_TICKET_SALE_STATUSES).optional(),
  soldAt: optionalDate.optional(),
  notes: optionalText.nullable().optional(),
});


export const ticketSaleActionSchema = z.object({
  reason: optionalText,
});

export const createCostumeSchema = z.object({
  eventId: eventIdSchema,
  name: requiredText('Informe o nome do figurino.'),
  description: optionalText,
  category: z.enum(EVENT_COSTUME_CATEGORIES),
  size: optionalText,
  color: optionalText,
  accessories: optionalText,
  schoolCost: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  chargedValue: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  supplier: optionalText,
  quantity: positiveIntSchema.default(1),
  notes: optionalText,
});

export const updateCostumeSchema = createCostumeSchema.omit({ eventId: true }).partial();

export const createCostumeAssignmentSchema = z.object({
  eventId: eventIdSchema,
  costumeId: z.string().trim().min(1),
  alunoId: optionalId,
  turmaId: optionalId,
  definedSize: optionalText,
  status: z.enum(EVENT_COSTUME_ASSIGNMENT_STATUSES).optional().default('PENDING'),
  billingMode: z.enum(eventCostumeAssignmentBillingModes).optional().default('SEPARATE_CHARGE'),
  chargedValue: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  isPaid: z.coerce.boolean().optional().default(false),
  deliveredAt: optionalDate,
  returnedAt: optionalDate,
  notes: optionalText,
});

export const updateCostumeAssignmentSchema = z.object({
  costumeId: z.string().trim().min(1).optional(),
  alunoId: optionalId,
  turmaId: optionalId,
  status: z.enum(EVENT_COSTUME_ASSIGNMENT_STATUSES).optional(),
  billingMode: z.enum(eventCostumeAssignmentBillingModes).optional(),
  definedSize: optionalText,
  chargedValue: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  isPaid: z.coerce.boolean().optional(),
  deliveredAt: optionalDate,
  returnedAt: optionalDate,
  notes: optionalText,
});

export const listFinancialEntriesQuerySchema = listByEventQuerySchema.extend({
  type: z.enum(EVENT_FINANCIAL_ENTRY_TYPES).optional(),
});

export const createEventFinancialEntrySchema = z.object({
  eventId: eventIdSchema,
  type: z.enum(EVENT_FINANCIAL_ENTRY_TYPES),
  category: requiredText('Informe a categoria.'),
  description: requiredText('Informe a descrição.'),
  supplier: optionalText,
  expectedAmount: moneySchema,
  actualAmount: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  refundedAmount: z.preprocess(emptyToUndefined, moneySchema.optional().nullable()),
  dueDate: optionalDate,
  realizedAt: optionalDate,
  status: z.enum(EVENT_FINANCIAL_ENTRY_STATUSES),
  paymentMethod: z.enum(EVENT_PAYMENT_METHODS).optional().nullable(),
  proofUrl: optionalText,
  notes: optionalText,
});

export const updateEventFinancialEntrySchema = createEventFinancialEntrySchema
  .omit({ eventId: true })
  .partial();

export const eventReportQuerySchema = z.object({
  eventId: z.string().trim().optional(),
  compareWithEventId: z.string().trim().optional(),
});

export const createEventParticipantSchema = z.object({
  eventId: eventIdSchema,
  alunoId: z.string().trim().min(1),
  responsavelId: z.string().trim().optional().nullable(),
  billingGroupId: z.string().trim().optional().nullable(),
  registrationFeeCharged: moneySchema.optional().default(0),
  registrationFeeOriginal: moneySchema.optional().nullable(),
  registrationFeeDiscount: moneySchema.optional().default(0),
  registrationFeeDiscountType: participantDiscountTypeSchema.optional().nullable(),
  billingMode: z.enum(['FULL', 'INSTALLMENT', 'ENTRY_INSTALLMENT']).optional().default('FULL'),
  entryAmount: moneySchema.optional().default(0),
  entryPaymentMethod: z.string().trim().optional().nullable(),
  initialPaymentAmount: moneySchema.optional().default(0),
  initialPaymentMethod: z.string().trim().optional().nullable(),
  billingMethod: z.string().trim().optional().nullable(),
  isFeePaid: z.coerce.boolean().optional().default(false),
  isFeeExempt: z.coerce.boolean().optional().default(false),
  feePaymentMethod: z.string().trim().optional().nullable(),
  notes: optionalText,
});

const eventParticipantBillingBaseSchema = z.object({
  responsavelId: z.string().trim().min(1).optional(),
  additionalAlunoIds: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  uiRequestId: z.string().trim().min(8).max(120).optional(),
  registrationFeeCharged: z.coerce.number().optional().default(0),
  registrationFeeOriginal: z.coerce.number().finite().min(0).optional(),
  discountValue: z.coerce.number().finite().min(0).optional().default(0),
  discountType: participantDiscountTypeSchema.optional().default('FIXED'),
  hasEntry: z.coerce.boolean().optional().default(false),
  entryAmount: z.coerce.number().min(0).optional().default(0),
  entryPaymentMethod: z.string().trim().optional().nullable(),
  initialPaymentAmount: z.coerce.number().min(0).optional().default(0),
  initialPaymentMethod: z.string().trim().optional().nullable(),
  billingMethod: z.enum(['MANUAL_RECEIVED', 'BOLETO', 'PIX', 'CREDIT_CARD']).optional().default('MANUAL_RECEIVED'),
  feePaymentMethod: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT']).optional(),
  installmentCount: z.coerce.number().int().min(2).max(24).optional(),
  notificationChannels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).optional().default([]),
  notificationChannelsConfigured: z.boolean().optional().default(false),
  isFeeExempt: z.coerce.boolean().optional().default(false),
});

function validateEventParticipantBilling(input: z.infer<typeof eventParticipantBillingBaseSchema>, ctx: z.RefinementCtx) {
  const participantCount = 1 + new Set(input.additionalAlunoIds ?? []).size;
  const originalAmount = input.registrationFeeOriginal ?? input.registrationFeeCharged;
  const discount = calculateEventParticipantDiscount({
    originalAmount,
    discountType: input.discountType,
    discountValue: input.discountValue,
    quantity: participantCount,
  });
  const requestedDiscountAmount = input.discountType === 'PERCENTAGE'
    ? discount.originalAmount * (input.discountValue / 100)
    : input.discountValue;
  if (input.discountType === 'PERCENTAGE' && input.discountValue > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: 'O desconto percentual não pode ser maior que 100%.' });
  }
  if (requestedDiscountAmount > discount.originalAmount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: 'O desconto não pode ser maior que o valor original.' });
  }
  if (input.billingMethod === 'MANUAL_RECEIVED') {
    const manualChargedTotal = discount.chargedAmount;
    if (input.hasEntry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasEntry'], message: 'Use o valor recebido agora para registrar uma baixa manual.' });
    }
    if (input.initialPaymentAmount > manualChargedTotal) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialPaymentAmount'], message: 'O valor recebido não pode ser maior que o valor final da inscrição.' });
    }
    if (input.initialPaymentAmount > 0 && !input.initialPaymentMethod && !input.feePaymentMethod) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialPaymentMethod'], message: 'Informe a forma de recebimento do pagamento inicial.' });
    }
    if (input.isFeeExempt && input.initialPaymentAmount > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['isFeeExempt'], message: 'Uma inscrição isenta não pode ter pagamento inicial.' });
    }
  } else if (input.isFeeExempt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['isFeeExempt'], message: 'A isenção só pode ser usada no modo manual.' });
  } else if (input.initialPaymentAmount > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialPaymentAmount'], message: 'Pagamento inicial manual só pode ser usado no modo manual.' });
  }
  if (!input.hasEntry) return;

  const totalRegistrationFee = discount.chargedAmount;

  if (input.additionalAlunoIds && input.additionalAlunoIds.length > 0 && !input.responsavelId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['responsavelId'], message: 'Selecione o responsável financeiro da cobrança agrupada.' });
  }
  if (input.registrationFeeCharged <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['registrationFeeCharged'], message: 'Informe a taxa total para usar uma entrada.' });
  }
  if (input.entryAmount <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entryAmount'], message: 'Informe o valor da entrada.' });
  } else if (input.entryAmount >= totalRegistrationFee) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entryAmount'], message: 'A entrada deve ser menor que a taxa total.' });
  }
  if (!input.entryPaymentMethod) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entryPaymentMethod'], message: 'Informe a forma de recebimento da entrada.' });
  }
  if (!['BOLETO', 'CREDIT_CARD'].includes(input.billingMethod)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingMethod'], message: 'O saldo parcelado deve ser cobrado por boleto ou cartão.' });
  }
  if (input.chargeType !== 'INSTALLMENT') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['chargeType'], message: 'O saldo com entrada deve ser parcelado.' });
  }
}

export const eventParticipantBillingRequestSchema = eventParticipantBillingBaseSchema.superRefine(validateEventParticipantBilling);

export const registerEventParticipantRequestSchema = eventParticipantBillingBaseSchema.extend({
  alunoId: z.string().trim().min(1),
}).superRefine(validateEventParticipantBilling);

export const reactivateEventParticipantRequestSchema = eventParticipantBillingRequestSchema;

export const reactivateEventParticipantSchema = createEventParticipantSchema.omit({ eventId: true, alunoId: true }).extend({
  dueDate: optionalDate,
  paymentProvider: optionalText,
  asaasPaymentId: optionalText,
  asaasInstallmentId: optionalText,
  standaloneChargeId: optionalText,
  paymentStatus: optionalText,
  billingMethod: z.enum(['MANUAL_RECEIVED', 'BOLETO', 'PIX', 'CREDIT_CARD']).optional(),
  chargeType: z.enum(['ONE_TIME', 'INSTALLMENT']).optional(),
  installmentCount: z.coerce.number().int().min(2).max(24).optional(),
  billingMode: z.enum(['FULL', 'INSTALLMENT', 'ENTRY_INSTALLMENT']).optional(),
  entryAmount: z.coerce.number().min(0).optional(),
  entryPaymentMethod: z.string().trim().optional().nullable(),
});

export const quitarParticipantFeeSchema = z.object({
  paymentMethod: z.string().trim().min(1),
});

export const manualEventParticipantPaymentSchema = z.object({
  amount: moneySchema.gt(0),
  paymentMethod: z.enum(EVENT_PAYMENT_METHODS),
  paidAt: optionalDate,
  notes: optionalText,
});

export type ListSchoolEventsQuery = z.infer<typeof listSchoolEventsQuerySchema>;
export type CreateSchoolEventInput = z.infer<typeof createSchoolEventSchema>;
export type UpdateSchoolEventInput = z.infer<typeof updateSchoolEventSchema>;
export type CreateTicketLotInput = z.infer<typeof createTicketLotSchema>;
export type UpdateTicketLotInput = z.infer<typeof updateTicketLotSchema>;
export type CreateTicketSaleInput = z.infer<typeof createTicketSaleSchema>;
export type UpdateTicketSaleInput = z.infer<typeof updateTicketSaleSchema>;
export type CreateCostumeInput = z.infer<typeof createCostumeSchema>;
export type UpdateCostumeInput = z.infer<typeof updateCostumeSchema>;
export type CreateCostumeAssignmentInput = z.infer<typeof createCostumeAssignmentSchema>;
export type UpdateCostumeAssignmentInput = z.infer<typeof updateCostumeAssignmentSchema>;
export type CreateEventFinancialEntryInput = z.infer<typeof createEventFinancialEntrySchema>;
export type UpdateEventFinancialEntryInput = z.infer<typeof updateEventFinancialEntrySchema>;
export type CreateEventParticipantInput = z.infer<typeof createEventParticipantSchema>;
export type ReactivateEventParticipantInput = z.infer<typeof reactivateEventParticipantSchema>;
export type QuitarParticipantFeeInput = z.infer<typeof quitarParticipantFeeSchema>;
export type ManualEventParticipantPaymentInput = z.infer<typeof manualEventParticipantPaymentSchema>;
