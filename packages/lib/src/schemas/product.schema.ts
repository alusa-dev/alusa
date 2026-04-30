import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').max(200),
  description: z
    .string()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  sku: z
    .string()
    .max(50)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  price: z
    .number({ required_error: 'Preço é obrigatório' })
    .positive('Preço deve ser maior que zero'),
  lowStockThreshold: z.number().int().min(0).default(5),
  categoryId: z.string().optional().nullable(),
});

export type ProductCreateInput = z.infer<typeof productSchema> & { contaId: string };
export type ProductUpdateInput = Partial<z.infer<typeof productSchema>>;
