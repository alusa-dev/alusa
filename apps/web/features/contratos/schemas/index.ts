import { z } from 'zod';

// ===================== Modelo de Contrato (PDF base) =====================

export const contratoModeloStatusSchema = z.enum(['ATIVO', 'INATIVO']);

const contratoModeloArquivoUrlSchema = z
  .string()
  .min(1, 'URL do PDF é obrigatória')
  .refine((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return value.startsWith('/');
    }
  }, 'URL do PDF inválida');

export const createContratoModeloSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').max(200),
  descricao: z.string().max(500).optional(),
  arquivoPdfUrl: contratoModeloArquivoUrlSchema,
  arquivoOriginalUrl: contratoModeloArquivoUrlSchema.optional(),
  mimeType: z.string().default('application/pdf'),
  hashSha256: z.string().min(64).max(64, 'Hash SHA-256 deve ter 64 caracteres'),
  tamanhoBytes: z.number().int().positive().optional(),
});
export type CreateContratoModeloInput = z.infer<typeof createContratoModeloSchema>;

export const updateContratoModeloSchema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    descricao: z.string().max(500).optional().nullable(),
    status: contratoModeloStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nenhum campo para atualizar',
  });
export type UpdateContratoModeloInput = z.infer<typeof updateContratoModeloSchema>;

// ===================== Contrato Gerado =====================

export const contratoStatusAssinaturaSchema = z.enum([
  'PENDENTE',
  'ASSINADO',
  'EXPIRADO',
  'CANCELADO',
]);
export type ContratoStatus = z.infer<typeof contratoStatusAssinaturaSchema>;

export const createContratoSchema = z.object({
  matriculaId: z.string().min(1, 'Matrícula é obrigatória'),
  modeloId: z.string().min(1, 'Modelo de contrato é obrigatório'),
  contratoOrigemId: z.string().optional(),
});
export type CreateContratoInput = z.infer<typeof createContratoSchema>;

// ===================== Assinatura =====================

const cpfDigitsSchema = z
  .string()
  .transform((value) => String(value ?? '').replace(/\D/g, ''))
  .refine((value) => value.length === 11, { message: 'CPF inválido' });

export const publicAssinarContratoSchema = z.object({
  cpf: cpfDigitsSchema,
  nome: z.string().trim().min(2, 'Nome inválido').max(160, 'Nome inválido'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  userAgent: z.string().trim().max(512, 'User agent inválido').optional(),
});
export type PublicAssinarContratoInput = z.infer<typeof publicAssinarContratoSchema>;

// ===================== Upload de PDF =====================

export const uploadContratoArquivoSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').max(200),
  descricao: z.string().max(500).optional(),
});
export type UploadContratoArquivoInput = z.infer<typeof uploadContratoArquivoSchema>;
