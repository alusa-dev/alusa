import { z } from 'zod';

export const planoStatusEnum = z.enum(['ATIVO', 'INATIVO']);
export type PlanoStatus = z.infer<typeof planoStatusEnum>;

export const planoPeriodicidadeEnum = z.enum([
  'SEMANAL',
  'QUINZENAL',
  'MENSAL',
  'TRIMESTRAL',
  'ANUAL',
]);
export type PlanoPeriodicidade = z.infer<typeof planoPeriodicidadeEnum>;

function normalizeValorInput(value: unknown): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return Math.round(parsed * 100) / 100;
  }
  return Number.NaN;
}

const nomeSchema = z
  .string({ required_error: 'Informe o nome do plano.' })
  .trim()
  .min(2, 'O nome deve ter pelo menos 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

const descricaoSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  })
  .refine((value) => value === null || value.length <= 400, {
    message: 'A descrição deve ter no máximo 400 caracteres.',
  });

const valorSchema = z
  .unknown()
  .transform((value) => normalizeValorInput(value))
  .refine((value) => !Number.isNaN(value), {
    message: 'Informe um valor válido.',
  })
  .refine((value) => value >= 0, {
    message: 'O valor deve ser maior ou igual a zero.',
  });

const basePlanoSchema = z.object({
  nome: nomeSchema,
  descricao: descricaoSchema,
  periodicidade: planoPeriodicidadeEnum,
  valor: valorSchema,
  status: planoStatusEnum.default('ATIVO').optional(),
});

export const planoFormSchema = basePlanoSchema.pick({
  nome: true,
  descricao: true,
  periodicidade: true,
  valor: true,
});

export type PlanoFormInput = z.input<typeof planoFormSchema>;
export type PlanoFormOutput = z.output<typeof planoFormSchema>;

export const planoCreateSchema = basePlanoSchema.extend({
  contaId: z.string().min(1, 'Conta obrigatória.'),
});

export type PlanoCreateInput = z.infer<typeof planoCreateSchema>;

export const planoUpdateSchema = basePlanoSchema.partial().extend({
  id: z.string().min(1, 'ID obrigatório.'),
  contaId: z.string().min(1, 'Conta obrigatória.'),
});

export type PlanoUpdateInput = z.infer<typeof planoUpdateSchema>;

export const planoFilterSchema = z.object({
  contaId: z.string().min(1, 'Conta obrigatória.'),
  status: planoStatusEnum.optional(),
  search: z
    .string()
    .trim()
    .min(1, 'Busca precisa de ao menos 1 caractere.')
    .max(120, 'Busca muito longa.')
    .optional()
    .transform((value) => (value && value.length ? value : undefined)),
});

export type PlanoFilterInput = z.infer<typeof planoFilterSchema>;
