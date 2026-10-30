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

export const EXPERT_CONTACT_STUDENT_RANGES = [
  '1 a 25',
  '26 a 50',
  '51 a 100',
  '101 a 150',
  '151 a 200',
  '201 a 300',
  '301 a 400',
  '401 a 500',
  'Mais de 500',
  'Ainda não sei',
] as const;

export const EXPERT_CONTACT_INSTITUTION_TYPES = [
  'Escola regular',
  'Escola de dança',
  'Curso livre',
  'Outra instituição de ensino',
] as const;

export const expertContactLeadInputDTOSchema = z.object({
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(180),
  institutionName: z.string().trim().min(2).max(160),
  institutionWebsite: z.string().trim().url().max(500).optional().or(z.literal('')),
  phone: z.string().trim().min(8).max(40),
  institutionType: z.enum(EXPERT_CONTACT_INSTITUTION_TYPES),
  studentsRange: z.enum(EXPERT_CONTACT_STUDENT_RANGES),
  requestId: z.string().uuid(),
  website: z.string().max(500).optional(),
}).strict();

export type ExpertContactLeadInputDTO = z.infer<typeof expertContactLeadInputDTOSchema>;
