import { z } from 'zod';

export const modalidadeSchema = z.object({
  nome: z.string().min(2).max(80),
  descricao: z.string().max(400).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).default('ATIVO').optional(),
});

export type ModalidadeCreateInput = z.infer<typeof modalidadeSchema> & { contaId: string };
export type ModalidadeUpdateInput = Partial<z.infer<typeof modalidadeSchema>> & {
  id: string;
  contaId: string;
};
