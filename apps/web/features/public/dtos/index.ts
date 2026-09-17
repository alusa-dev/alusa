import { z } from 'zod';

export const publicEventContractRouteParamsDTOSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

export const publicEventMapCheckoutRouteParamsDTOSchema = z.object({
  publicSlug: z.string().trim().min(1).max(128),
});

export const earlyAccessLeadInputDTOSchema = z
  .object({
    institutionName: z.string().trim().min(2).max(160),
    contactName: z.string().trim().min(2).max(120),
    role: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(180),
    phone: z.string().trim().min(8).max(40),
    studentsRange: z.string().trim().min(1).max(40),
    mainChallenge: z.string().trim().max(500).optional().or(z.literal('')),
    marketingConsent: z.literal(true),
    website: z.string().max(0).optional(),
  })
  .strict();

export type EarlyAccessLeadInputDTO = z.infer<typeof earlyAccessLeadInputDTOSchema>;
