import { z } from 'zod';

/**
 * DTO para dados de responsável no contexto de matrícula
 * ADR: Wizard de Matrícula com Contrato Formal
 * 
 * Regra: Responsável financeiro é obrigatório para menores de idade
 */
export const responsavelDTOSchema = z.object({
  id: z.string().min(1).optional(),
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  cpf: z.string().min(11, 'CPF inválido'),
  email: z.string().email('Email inválido'),
  telefone: z.string().min(10, 'Telefone inválido'),
  tipoVinculo: z.enum(['FINANCEIRO', 'PRINCIPAL', 'PAI', 'MAE', 'OUTRO']).default('FINANCEIRO'),
  endereco: z.object({
    cep: z.string().length(8).optional().nullable(),
    logradouro: z.string().optional().nullable(),
    numero: z.string().optional().nullable(),
    complemento: z.string().optional().nullable(),
    bairro: z.string().optional().nullable(),
    cidade: z.string().optional().nullable(),
    uf: z.string().length(2).optional().nullable(),
  }).optional().nullable(),
});

export type ResponsavelDTO = z.infer<typeof responsavelDTOSchema>;

/**
 * Schema para criação de responsável (sem id)
 */
export const createResponsavelDTOSchema = responsavelDTOSchema.omit({ id: true });

export type CreateResponsavelDTO = z.infer<typeof createResponsavelDTOSchema>;
