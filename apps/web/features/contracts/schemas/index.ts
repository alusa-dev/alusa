import { z } from 'zod';

// ===================== Modelo de Contrato (PDF base) =====================

export const contratoModeloStatusSchema = z.enum(['ATIVO', 'INATIVO']);

export const contratoConsentimentoFinalidadeSchema = z.enum([
  'IMAGE_USE',
  'MARKETING',
  'COMMUNICATIONS',
  'OTHER',
]);

const contratoConsentimentoInputSchema = z.object({
  templateId: z.string().trim().min(1).nullable().optional(),
  finalidade: contratoConsentimentoFinalidadeSchema,
  titulo: z.string().trim().min(3, 'Informe o título do consentimento').max(160),
  texto: z.string().trim().min(10, 'Informe o texto do consentimento').max(5000),
  papel: z.literal('RESPONSAVEL_OU_ALUNO').default('RESPONSAVEL_OU_ALUNO'),
  obrigatorio: z.boolean().default(true),
  ordem: z.number().int().nonnegative().default(0),
});

const contratoConsentimentosSchema = z
  .array(contratoConsentimentoInputSchema)
  .max(20, 'Configure no máximo 20 consentimentos.')
  .default([]);

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
  campos: z.array(z.object({
    tipo: z.enum(['ASSINATURA', 'RUBRICA']),
    papel: z.enum(['ESCOLA', 'RESPONSAVEL_OU_ALUNO']),
    pagina: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    largura: z.number().positive().max(1),
    altura: z.number().positive().max(1),
    obrigatorio: z.boolean().default(true),
    ordem: z.number().int().nonnegative().default(0),
  })).min(2, 'Configure os campos de assinatura da escola e do responsável/aluno').refine(
    (fields) => fields.some((field) => field.papel === 'ESCOLA') && fields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO'),
    'Configure ao menos um campo da escola e um campo do responsável/aluno',
  ),
  consentimentos: contratoConsentimentosSchema,
});
export type CreateContratoModeloInput = z.infer<typeof createContratoModeloSchema>;

export const updateContratoModeloSchema = z
  .object({
    nome: z.string().min(1).max(200).optional(),
    descricao: z.string().max(500).optional().nullable(),
    status: contratoModeloStatusSchema.optional(),
    campos: z.array(z.object({
      tipo: z.enum(['ASSINATURA', 'RUBRICA']),
      papel: z.enum(['ESCOLA', 'RESPONSAVEL_OU_ALUNO']),
      pagina: z.number().int().positive(),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      largura: z.number().positive().max(1),
      altura: z.number().positive().max(1),
      obrigatorio: z.boolean().default(true),
      ordem: z.number().int().nonnegative().default(0),
    })).min(2, 'Configure os campos de assinatura da escola e do responsável/aluno').refine(
      (fields) => fields.some((field) => field.papel === 'ESCOLA') && fields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO'),
      'Configure ao menos um campo da escola e um campo do responsável/aluno',
    ).optional(),
    consentimentos: contratoConsentimentosSchema.optional(),
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
  verificationToken: z.string().min(32, 'Autorização de assinatura inválida'),
  nome: z.string().trim().min(2, 'Nome inválido').max(160, 'Nome inválido'),
  dataNascimento: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Data de nascimento inválida').optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  aceite: z.literal(true, {
    errorMap: () => ({ message: 'Aceite explícito é obrigatório.' }),
  }),
  consentimentos: z.array(z.object({
    termId: z.string().min(1),
    decision: z.enum(['AUTORIZADO', 'RECUSADO']),
  })).max(20).default([]),
  userAgent: z.string().trim().max(512, 'User agent inválido').optional(),
  assinatura: z.object({
    tipo: z.enum(['TEXTO', 'DESENHADA']),
    valor: z.string().trim().min(1).max(200_000),
    fonte: z.string().trim().max(80).optional(),
  }),
});
export type PublicAssinarContratoInput = z.infer<typeof publicAssinarContratoSchema>;

export const publicSolicitarAssinaturaOtpSchema = z.object({
  cpf: cpfDigitsSchema,
});

export const publicVerificarAssinaturaOtpSchema = z.object({
  cpf: cpfDigitsSchema,
  code: z.string().regex(/^\d{6}$/, 'Código inválido'),
});

// ===================== Upload de PDF =====================

export const uploadContratoArquivoSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório').max(200),
  descricao: z.string().max(500).optional(),
});
export type UploadContratoArquivoInput = z.infer<typeof uploadContratoArquivoSchema>;
