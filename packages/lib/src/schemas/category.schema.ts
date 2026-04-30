import { z } from 'zod';

export const categorySchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(100),
});

export type CategoryCreateInput = z.infer<typeof categorySchema> & { contaId: string };
