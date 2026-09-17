import { z } from 'zod';

export const sendWhatsAppTargetInputDTOSchema = z.object({
  to: z.string().min(8).max(32),
});

export type SendWhatsAppTargetInputDTO = z.infer<typeof sendWhatsAppTargetInputDTOSchema>;

export const whatsappTestMessageInputDTOSchema = z.object({
  to: z.string().min(8).max(32),
  mode: z.enum(['template', 'text']).default('template'),
  body: z.string().trim().max(4096).optional(),
});

export type WhatsAppTestMessageInputDTO = z.infer<typeof whatsappTestMessageInputDTOSchema>;
