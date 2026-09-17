import { z } from 'zod';

export const eventRouteParamsDTOSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
});

export const eventContractRouteParamsDTOSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export const eventParticipantRouteParamsDTOSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  participantId: z.string().trim().min(1).max(128),
});

export const eventPublicOrderRouteParamsDTOSchema = z.object({
  orderId: z.string().trim().min(1).max(128),
});

export const eventPublicOrderNestedRouteParamsDTOSchema = z.object({
  eventId: z.string().trim().min(1).max(128),
  orderId: z.string().trim().min(1).max(128),
});

export const eventPaymentBookQueryDTOSchema = z.object({
  planId: z.string().trim().min(1).max(128).optional(),
});

const eventCostumeAssignmentStatusDTOSchema = z.enum([
  'PENDING',
  'ORDERED',
  'RECEIVED',
  'DELIVERED',
  'RETURNED',
  'DAMAGED',
  'LOST',
  'CANCELLED',
]);

export const eventParticipantPatchInputDTOSchema = z.object({
  notes: z.string().trim().nullable().optional(),
  isFeePaid: z.boolean().optional(),
  registrationFeeOriginal: z.number().finite().min(0).optional(),
  discountType: z.enum(['FIXED', 'PERCENTAGE']).optional(),
  discountValue: z.number().finite().min(0).optional(),
  costumes: z
    .array(
      z.object({
        id: z.string(),
        definedSize: z.string().trim().nullable().optional(),
        status: eventCostumeAssignmentStatusDTOSchema.optional(),
        notes: z.string().trim().nullable().optional(),
      }),
    )
    .optional(),
});
export type EventParticipantPatchInputDTO = z.infer<typeof eventParticipantPatchInputDTOSchema>;

export const eligibleEventStudentsQueryDTOSchema = z.object({
  anchorAlunoId: z.string().trim().optional(),
  responsavelId: z.string().trim().optional(),
  q: z.string().trim().optional(),
});
export type EligibleEventStudentsQueryDTO = z.infer<typeof eligibleEventStudentsQueryDTOSchema>;
