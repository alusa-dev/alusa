import { z } from 'zod';
import {
  contratoModeloStatusSchema,
  contratoStatusAssinaturaSchema,
  createContratoModeloSchema,
  createContratoSchema,
  publicAssinarContratoSchema,
  updateContratoModeloSchema,
  uploadContratoArquivoSchema,
} from '../schemas';

const dateStringDTOSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida');

const optionalDateStringDTOSchema = dateStringDTOSchema.nullable();
const optionalStringDTOSchema = z.string().nullable();

export const contratoRouteParamsDTOSchema = z.object({
  id: z.string().min(1),
});
export type ContratoRouteParamsDTO = z.infer<typeof contratoRouteParamsDTOSchema>;

export const contratoPublicTokenParamsDTOSchema = z.object({
  token: z.string().min(1),
});
export type ContratoPublicTokenParamsDTO = z.infer<typeof contratoPublicTokenParamsDTOSchema>;

export const contratoStatusDTOSchema = contratoStatusAssinaturaSchema;
export type ContratoStatusDTO = z.infer<typeof contratoStatusDTOSchema>;

export const createContratoInputDTOSchema = createContratoSchema;
export type CreateContratoInputDTO = z.input<typeof createContratoInputDTOSchema>;

export const createContratoModeloInputDTOSchema = createContratoModeloSchema;
export type CreateContratoModeloInputDTO = z.input<typeof createContratoModeloInputDTOSchema>;

export const updateContratoModeloInputDTOSchema = updateContratoModeloSchema;
export type UpdateContratoModeloInputDTO = z.input<typeof updateContratoModeloInputDTOSchema>;

export const publicAssinarContratoInputDTOSchema = publicAssinarContratoSchema;
export type PublicAssinarContratoInputDTO = z.input<typeof publicAssinarContratoInputDTOSchema>;

export const uploadContratoArquivoInputDTOSchema = uploadContratoArquivoSchema;
export type UploadContratoArquivoInputDTO = z.input<typeof uploadContratoArquivoInputDTOSchema>;

export const listContratosQueryDTOSchema = z.object({
  matriculaId: z.string().trim().min(1).optional(),
  alunoId: z.string().trim().min(1).optional(),
  status: contratoStatusDTOSchema.optional(),
});
export type ListContratosQueryDTO = z.infer<typeof listContratosQueryDTOSchema>;

export const listAlunosComContratosQueryDTOSchema = z.object({
  q: z.string().trim().optional(),
  status: contratoStatusDTOSchema.optional(),
  turmaId: z.string().trim().min(1).optional(),
});
export type ListAlunosComContratosQueryDTO = z.infer<typeof listAlunosComContratosQueryDTOSchema>;

export const contratoAlunoDTOSchema = z.object({
  id: optionalStringDTOSchema.default(null),
  nome: z.string(),
  cpf: optionalStringDTOSchema.default(null),
});
export type ContratoAlunoDTO = z.infer<typeof contratoAlunoDTOSchema>;

export const contratoTurmaDTOSchema = z.object({
  id: optionalStringDTOSchema.default(null),
  nome: z.string(),
});
export type ContratoTurmaDTO = z.infer<typeof contratoTurmaDTOSchema>;

export const contratoModeloResumoDTOSchema = z.object({
  id: optionalStringDTOSchema.default(null),
  nome: z.string(),
});
export type ContratoModeloResumoDTO = z.infer<typeof contratoModeloResumoDTOSchema>;

export const contratoMatriculaResumoDTOSchema = z.object({
  id: z.string(),
  contratoAtualId: optionalStringDTOSchema.default(null),
  aluno: contratoAlunoDTOSchema,
  turma: contratoTurmaDTOSchema.nullable().default(null),
});
export type ContratoMatriculaResumoDTO = z.infer<typeof contratoMatriculaResumoDTOSchema>;

export const contratoSubscriptionSyncDTOSchema = z.object({
  success: z.boolean(),
  error: optionalStringDTOSchema.default(null).optional(),
  asaasSubscriptionId: optionalStringDTOSchema.default(null).optional(),
  asaasPaymentId: optionalStringDTOSchema.default(null).optional(),
  invoiceUrl: optionalStringDTOSchema.default(null).optional(),
  bankSlipUrl: optionalStringDTOSchema.default(null).optional(),
  expectedWebhooks: z.array(z.string()).default([]).optional(),
  message: optionalStringDTOSchema.default(null).optional(),
});
export type ContratoSubscriptionSyncDTO = z.infer<typeof contratoSubscriptionSyncDTOSchema>;

export const contratoDTOSchema = z.object({
  id: z.string(),
  matriculaId: z.string(),
  modeloId: optionalStringDTOSchema.default(null),
  contratoOrigemId: optionalStringDTOSchema.default(null),
  arquivoPdfUrl: z.string(),
  hashPdf: z.string(),
  arquivoPdfAssinadoUrl: optionalStringDTOSchema.default(null),
  hashPdfAssinado: optionalStringDTOSchema.default(null),
  status: contratoStatusDTOSchema,
  assinadoPor: optionalStringDTOSchema.default(null),
  assinadoEmail: optionalStringDTOSchema.default(null),
  assinadoCpf: optionalStringDTOSchema.default(null),
  assinadoIp: optionalStringDTOSchema.default(null),
  assinadoEm: optionalDateStringDTOSchema.default(null),
  assinadoUserAgent: optionalStringDTOSchema.default(null),
  hashAssinatura: optionalStringDTOSchema.default(null),
  tokenPublico: z.string(),
  tokenExpiraEm: optionalDateStringDTOSchema.default(null),
  createdAt: dateStringDTOSchema,
  updatedAt: dateStringDTOSchema,
  modelo: contratoModeloResumoDTOSchema.nullable().default(null),
  matricula: contratoMatriculaResumoDTOSchema,
  subscriptionSync: contratoSubscriptionSyncDTOSchema.nullable().optional(),
});
export type ContratoDTO = z.infer<typeof contratoDTOSchema>;

export const listContratosResultDTOSchema = z.array(contratoDTOSchema);
export type ListContratosResultDTO = z.infer<typeof listContratosResultDTOSchema>;

export const alunoContratoCardDTOSchema = z.object({
  id: z.string(),
  nome: z.string(),
  foto: optionalStringDTOSchema.default(null),
});
export type AlunoContratoCardDTO = z.infer<typeof alunoContratoCardDTOSchema>;

export const listAlunosComContratosResultDTOSchema = z.array(alunoContratoCardDTOSchema);
export type ListAlunosComContratosResultDTO = z.infer<typeof listAlunosComContratosResultDTOSchema>;

export const contratoModeloCountDTOSchema = z.object({
  contratos: z.number().int().nonnegative(),
});
export type ContratoModeloCountDTO = z.infer<typeof contratoModeloCountDTOSchema>;

export const contratoModeloDTOSchema = z.object({
  id: z.string(),
  contaId: z.string(),
  nome: z.string(),
  descricao: optionalStringDTOSchema.default(null),
  arquivoOriginalUrl: optionalStringDTOSchema.default(null),
  arquivoPdfUrl: z.string(),
  mimeType: z.string(),
  hashSha256: z.string(),
  tamanhoBytes: z.number().int().positive().nullable().default(null),
  versao: z.number().int().positive(),
  status: contratoModeloStatusSchema,
  createdAt: dateStringDTOSchema,
  updatedAt: dateStringDTOSchema,
  _count: contratoModeloCountDTOSchema.optional(),
});
export type ContratoModeloDTO = z.infer<typeof contratoModeloDTOSchema>;

export const listContratoModelosResultDTOSchema = z.array(contratoModeloDTOSchema);
export type ListContratoModelosResultDTO = z.infer<typeof listContratoModelosResultDTOSchema>;

export const deleteContratoResultDTOSchema = z.object({
  message: z.string(),
});
export type DeleteContratoResultDTO = z.infer<typeof deleteContratoResultDTOSchema>;

export const deleteContratoModeloResultDTOSchema = z.object({
  message: z.string(),
  inactivated: z.boolean().optional(),
});
export type DeleteContratoModeloResultDTO = z.infer<typeof deleteContratoModeloResultDTOSchema>;

export const expireContratosResultDTOSchema = z.object({
  updated: z.number().int().nonnegative(),
});
export type ExpireContratosResultDTO = z.infer<typeof expireContratosResultDTOSchema>;

export const uploadContratoArquivoResultDTOSchema = z.object({
  url: z.string(),
  hashSha256: z.string().length(64),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  originalUrl: optionalStringDTOSchema.optional(),
});
export type UploadContratoArquivoResultDTO = z.infer<typeof uploadContratoArquivoResultDTOSchema>;

export const contratoPublicoDTOSchema = z.object({
  id: z.string(),
  arquivoPdfUrl: z.string(),
  hashPdf: z.string(),
  status: contratoStatusDTOSchema,
  tokenExpiraEm: optionalDateStringDTOSchema.default(null),
  acceptanceText: z.string(),
  acceptanceVersion: z.number().int().positive(),
  matricula: z.object({
    aluno: z.object({
      nome: z.string(),
    }),
    responsavelFinanceiro: z
      .object({
        nome: z.string(),
      })
      .nullable()
      .default(null),
  }),
});
export type ContratoPublicoDTO = z.infer<typeof contratoPublicoDTOSchema>;

export const publicAssinarContratoResultDTOSchema = z.object({
  success: z.literal(true),
  hash: z.string().length(64),
  signedPdfHash: z.string().length(64).optional(),
  signedPdfUrl: z.string().optional(),
});
export type PublicAssinarContratoResultDTO = z.infer<typeof publicAssinarContratoResultDTOSchema>;
