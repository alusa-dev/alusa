import { z } from 'zod';

export const salaSchema = z.object({
  nome: z.string().min(3, 'Nome muito curto').max(100),
  descricao: z
    .string()
    .max(400)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  capacidade: z
    .number({ required_error: 'Capacidade é obrigatória' })
    .int('Capacidade deve ser número inteiro')
    .positive('Capacidade deve ser > 0')
    .max(5000, 'Capacidade exagerada'),
  status: z.enum(['ATIVO', 'INATIVO']).default('ATIVO').optional(),
});

export type SalaCreateInput = z.infer<typeof salaSchema> & { contaId: string };
export type SalaUpdateInput = Partial<Omit<z.infer<typeof salaSchema>, 'status'>> & {
  nome?: string;
  descricao?: string;
  capacidade?: number;
  status?: 'ATIVO' | 'INATIVO';
};
