import { z } from 'zod';

export const privacyExportRequestInputDTOSchema = z
  .object({
    subjectType: z.enum(['USER', 'ALUNO', 'RESPONSAVEL', 'CONTA']).default('USER'),
    subjectId: z.string().trim().max(128).optional(),
    details: z.string().trim().max(2000).optional(),
  })
  .strict();
export type PrivacyExportRequestInputDTO = z.infer<
  typeof privacyExportRequestInputDTOSchema
>;

export const privacyRequestRouteParamsDTOSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
});
export type PrivacyRequestRouteParamsDTO = z.infer<typeof privacyRequestRouteParamsDTOSchema>;

export const publicPrivacyRequestDTOSchema = z
  .object({
    requesterName: z.string().trim().min(2).max(120),
    requesterEmail: z.string().trim().email().max(180),
    requestType: z.enum([
      'CONFIRMATION',
      'ACCESS',
      'CORRECTION',
      'ANONYMIZATION',
      'BLOCKING',
      'DELETION',
      'PORTABILITY',
      'SHARING_INFO',
      'CONSENT_REVOCATION',
      'OPPOSITION',
      'AUTOMATED_DECISION_REVIEW',
    ]),
    details: z.string().trim().min(10).max(3000),
  })
  .strict();
export type PublicPrivacyRequestDTO = z.infer<typeof publicPrivacyRequestDTOSchema>;
