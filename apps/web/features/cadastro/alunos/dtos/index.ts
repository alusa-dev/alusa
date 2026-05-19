import { z } from 'zod';
import { alunoCreateSchema, alunoUpdateSchema } from '@alusa/lib/client';

const dateLikeDTOSchema = z.union([z.string(), z.date()]);

export const createAlunoInputDTOSchema = alunoCreateSchema;
export type CreateAlunoInputDTO = z.input<typeof createAlunoInputDTOSchema>;

export const updateAlunoInputDTOSchema = alunoUpdateSchema;
export type UpdateAlunoInputDTO = z.input<typeof updateAlunoInputDTOSchema>;

export const alunoListItemDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string().nullable().optional(),
  telefone: z.string().nullable().optional(),
  status: z.string(),
  foto: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  consentimentoImagem: z.boolean().nullable().optional(),
  dataConsentimentoImagem: dateLikeDTOSchema.nullable().optional(),
  isentoTaxaMatricula: z.boolean().nullable().optional(),
  bolsaDescontoPercent: z.number().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  dataInativacao: dateLikeDTOSchema.nullable().optional(),
  motivoInativacao: z.string().nullable().optional(),
});

export type AlunoListItemDTO = z.infer<typeof alunoListItemDTOSchema>;

export const listAlunosResultDTOSchema = z.object({
  items: z.array(alunoListItemDTOSchema),
  total: z.number().int().nonnegative().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
});

export type ListAlunosResultDTO = z.infer<typeof listAlunosResultDTOSchema>;

export const alunoResponsavelEnderecoDTOSchema = z.object({
  cep: z.string().nullable().optional(),
  logradouro: z.string().nullable().optional(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  cidade: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
});

export type AlunoResponsavelEnderecoDTO = z.infer<typeof alunoResponsavelEnderecoDTOSchema>;

export const alunoResponsavelResumoDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  cpf: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  telefone: z.string().nullable().optional(),
  endereco: alunoResponsavelEnderecoDTOSchema.nullable().optional(),
});

export type AlunoResponsavelResumoDTO = z.infer<typeof alunoResponsavelResumoDTOSchema>;

export const alunoDetailDTOSchema = z
  .object({
    id: z.string(),
    nome: z.string(),
    cpf: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    telefone: z.string().nullable().optional(),
    foto: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    status: z.string().optional(),
    responsavel: alunoResponsavelResumoDTOSchema.nullable().optional(),
  })
  .passthrough();

export type AlunoDetailDTO = z.infer<typeof alunoDetailDTOSchema>;

export const listAlunosForResponsavelItemDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.string().nullable(),
  idade: z.number().int().nullable(),
});

export type ListAlunosForResponsavelItemDTO = z.infer<
  typeof listAlunosForResponsavelItemDTOSchema
>;

export const listAlunosForResponsavelResultDTOSchema = z.object({
  alunos: z.array(listAlunosForResponsavelItemDTOSchema),
});

export type ListAlunosForResponsavelResultDTO = z.infer<
  typeof listAlunosForResponsavelResultDTOSchema
>;

export const alunoDeletionBlockersDTOSchema = z.object({
  activeMatriculas: z.number().int().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
  cobrancas: z.object({
    pending: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    paid: z.number().int().nonnegative(),
  }),
});

export type AlunoDeletionBlockersDTO = z.infer<typeof alunoDeletionBlockersDTOSchema>;

const alunoDeleteSummaryDTOSchema = z
  .object({
    id: z.string(),
    nome: z.string().optional(),
  })
  .passthrough();

export const alunoDeleteResultDTOSchema = z.object({
  aluno: alunoDeleteSummaryDTOSchema,
  deletion: z.object({
    outcome: z.enum(['ARCHIVED', 'HARD_DELETED']),
    blockers: alunoDeletionBlockersDTOSchema,
    customerInactivation: z
      .object({
        action: z.string(),
        reason: z.string().optional(),
      })
      .optional(),
    impact: z.object({
      matriculas: z.object({
        cancelled: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
      }),
      subscriptions: z.object({
        deleted: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
      }),
    }),
    gatewaySync: z.object({
      ok: z.boolean(),
      errors: z.array(z.unknown()),
    }),
  }),
});

export type AlunoDeleteResultDTO = z.infer<typeof alunoDeleteResultDTOSchema>;
