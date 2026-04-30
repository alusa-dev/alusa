import { z } from 'zod';

export const comboStatusEnum = z.enum(['ATIVO', 'INATIVO']);

// Periodicidade do combo (ciclo de cobrança) - alinhado com PeriodicidadePlano do Prisma
export const comboPeriodicidadeEnum = z.enum([
  'SEMANAL',
  'QUINZENAL',
  'MENSAL',
  'TRIMESTRAL',
  'ANUAL',
]);

// Normalização de monetários (string/number) -> number com 2 casas
function normalizeMoney(v: unknown): number {
  if (v === null || v === undefined) return Number.NaN;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : Number.NaN;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return Number.NaN;
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
  }
  return Number.NaN;
}

const moneySchema = z
  .unknown()
  .transform(normalizeMoney)
  .refine((n) => !Number.isNaN(n), 'Valor inválido')
  .refine((n) => n > 0, 'Valor deve ser maior que zero');

const comboBaseObj = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      return t.length ? t : null;
    })
    .refine((v) => v === null || v.length <= 400, 'Descrição muito longa'),
  valor: moneySchema, // Valor do ciclo (conforme periodicidade)
  periodicidade: comboPeriodicidadeEnum.default('MENSAL'), // Ciclo de cobrança (Asaas)
  status: comboStatusEnum.default('ATIVO').optional(),
  vagasLimite: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'string' ? Number(v) : v))
    .refine((v) => v === undefined || Number.isInteger(v), 'vagasLimite deve ser inteiro')
    .refine((v) => v === undefined || v > 0, 'vagasLimite deve ser > 0')
    .optional(),
});

export const comboBaseSchema = comboBaseObj;

export const comboCreateSchema = comboBaseObj.extend({
  contaId: z.string().min(1),
  turmaIds: z.array(z.string().min(1)).default([]).optional(),
});
export type ComboCreateInput = z.infer<typeof comboCreateSchema>;

export const comboUpdateSchema = comboBaseObj.partial().extend({
  id: z.string().min(1),
  contaId: z.string().min(1),
  turmaIds: z.array(z.string().min(1)).optional(),
});
export type ComboUpdateInput = z.infer<typeof comboUpdateSchema>;

export const comboFilterSchema = z.object({
  contaId: z.string().min(1),
  status: comboStatusEnum.optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .transform((v) => (v && v.length ? v : undefined)),
});
export type ComboFilterInput = z.infer<typeof comboFilterSchema>;

export interface ComboDTO {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  valor: number; // Valor do ciclo (conforme periodicidade)
  periodicidade: string; // Ciclo de cobrança (MENSAL, TRIMESTRAL, ANUAL, etc.)
  status: string;
  vagasLimite: number | null;
  turmas: { id: string; nome: string }[];
  createdAt: Date;
  updatedAt: Date;
}
