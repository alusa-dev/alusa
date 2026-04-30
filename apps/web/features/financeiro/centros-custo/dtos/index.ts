import { z } from 'zod';

const nullableStringDTOSchema = z.string().nullable();

export const centroCustoRouteParamsDTOSchema = z.object({
  id: z.string().min(1),
});

export type CentroCustoRouteParamsDTO = z.infer<typeof centroCustoRouteParamsDTOSchema>;

export const centroCustoQueryDTOSchema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA', 'MISTO']).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

export type CentroCustoQueryDTO = z.infer<typeof centroCustoQueryDTOSchema>;

export const centroCustoInputDTOSchema = z.object({
  nome: z.string().min(2).max(120),
  tipo: z.enum(['RECEITA', 'DESPESA', 'MISTO']),
  descricao: z.string().max(500).optional().nullable(),
  status: z.enum(['ATIVO', 'INATIVO']).optional().default('ATIVO'),
});

export type CentroCustoInputDTO = z.infer<typeof centroCustoInputDTOSchema>;

export const centroCustoStatusInputDTOSchema = z.object({
  status: z.enum(['ATIVO', 'INATIVO']),
});

export type CentroCustoStatusInputDTO = z.infer<typeof centroCustoStatusInputDTOSchema>;

export const centroCustoDTOSchema = z
  .object({
    id: z.string(),
    contaId: z.string().optional(),
    nome: z.string(),
    tipo: z.enum(['RECEITA', 'DESPESA', 'MISTO']),
    descricao: nullableStringDTOSchema.default(null),
    status: z.enum(['ATIVO', 'INATIVO']),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    _count: z
      .object({
        lancamentos: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .passthrough();

export type CentroCustoDTO = z.infer<typeof centroCustoDTOSchema>;

export const listCentroCustoResultDTOSchema = z.object({
  data: z.array(centroCustoDTOSchema),
});

export type ListCentroCustoResultDTO = z.infer<typeof listCentroCustoResultDTOSchema>;

export const centroCustoMutationResultDTOSchema = z.object({
  data: centroCustoDTOSchema,
});

export type CentroCustoMutationResultDTO = z.infer<typeof centroCustoMutationResultDTOSchema>;

export const centroCustoDeleteResultDTOSchema = z.object({
  success: z.literal(true),
});

export type CentroCustoDeleteResultDTO = z.infer<typeof centroCustoDeleteResultDTOSchema>;
