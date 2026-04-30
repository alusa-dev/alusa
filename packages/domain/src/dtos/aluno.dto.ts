import { z } from 'zod';

/**
 * DTO para dados de aluno no contexto de matrícula
 * ADR: Wizard de Matrícula com Contrato Formal
 */
export const alunoDTOSchema = z.object({
  id: z.string().min(1, 'ID do aluno é obrigatório').optional(),
  nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  nomeSocial: z.string().optional().nullable(),
  dataNasc: z.coerce.date(),
  cpf: z.string().optional().nullable(),
  email: z.string().email('Email inválido').optional().nullable(),
  telefone: z.string().optional().nullable(),
  foto: z.string().url().optional().nullable(),
  genero: z.enum(['MASCULINO', 'FEMININO', 'NAO_BINARIO', 'OUTRO', 'PREFERE_NAO_INFORMAR']).optional().nullable(),
  endereco: z.object({
    cep: z.string().length(8).optional().nullable(),
    logradouro: z.string().optional().nullable(),
    numero: z.string().optional().nullable(),
    complemento: z.string().optional().nullable(),
    bairro: z.string().optional().nullable(),
    cidade: z.string().optional().nullable(),
    uf: z.string().length(2).optional().nullable(),
  }).optional().nullable(),
  observacao: z.string().optional().nullable(),
  consentimentoImagem: z.boolean().default(false),
  consentimentoComunicacoes: z.boolean().default(true),
});

export type AlunoDTO = z.infer<typeof alunoDTOSchema>;

/**
 * Schema para criação de aluno (sem id)
 */
export const createAlunoDTOSchema = alunoDTOSchema.omit({ id: true });

export type CreateAlunoDTO = z.infer<typeof createAlunoDTOSchema>;

/**
 * Schema para atualização de aluno (id obrigatório)
 */
export const updateAlunoDTOSchema = alunoDTOSchema.extend({
  id: z.string().min(1, 'ID do aluno é obrigatório'),
}).partial().required({ id: true });

export type UpdateAlunoDTO = z.infer<typeof updateAlunoDTOSchema>;
