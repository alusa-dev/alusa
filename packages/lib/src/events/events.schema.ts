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
const positiveIntSchema = z.coerce.number().int().positive();
const eventCostumeAssignmentBillingModes = [
  'INCLUDED_IN_REGISTRATION_FEE',
  'SEPARATE_CHARGE',
  'FREE',
] as const;

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
    quantityTotal: positiveIntSchema,
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

export const createTicketSaleSchema = z.object({
  eventId: eventIdSchema,
  lotId: z.string().trim().min(1),
  buyerName: requiredText('Informe o comprador.'),
  alunoId: optionalId,
  responsavelId: optionalId,
  quantity: positiveIntSchema,
  paymentMethod: z.enum(EVENT_PAYMENT_METHODS),
  status: z.enum(EVENT_TICKET_SALE_STATUSES).optional().default('PENDING'),
  soldAt: optionalDate,
  notes: optionalText,
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
  registrationFeeCharged: moneySchema.optional().default(0),
  isFeePaid: z.coerce.boolean().optional().default(false),
  feePaymentMethod: z.string().trim().optional().nullable(),
  notes: optionalText,
});

export const quitarParticipantFeeSchema = z.object({
  paymentMethod: z.string().trim().min(1),
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
export type QuitarParticipantFeeInput = z.infer<typeof quitarParticipantFeeSchema>;
