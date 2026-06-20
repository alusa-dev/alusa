import { z } from 'zod';

const invoiceStatusSchema = z.enum([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
]);

export const notaFiscalPersonTypeSchema = z.enum(['ALUNO', 'RESPONSAVEL']);

export const notaFiscalReadinessDTOSchema = z.object({
  ready: z.boolean(),
  issues: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
    }),
  ),
});

export const notaFiscalPersonIndexItemDTOSchema = z.object({
  id: z.string(),
  tipo: notaFiscalPersonTypeSchema,
  nome: z.string(),
  cpfMasked: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  totalNotas: z.number().int().nonnegative(),
  notasEmitidas: z.number().int().nonnegative(),
  valorTotalEmitido: z.number(),
  ultimaNotaEm: z.string().nullable(),
  statusDestaque: invoiceStatusSchema.nullable(),
});

export const listNotaFiscalPersonIndexResultDTOSchema = z.object({
  data: z.array(notaFiscalPersonIndexItemDTOSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  readiness: notaFiscalReadinessDTOSchema,
});

export type ListNotaFiscalPersonIndexResultDTO = z.infer<
  typeof listNotaFiscalPersonIndexResultDTOSchema
>;

export const notaFiscalKpisDTOSchema = z.object({
  totalNotas: z.number().int().nonnegative(),
  totalEmitidas: z.number().int().nonnegative(),
  totalValor: z.number(),
  ultimaNotaEm: z.string().nullable(),
  comErro: z.number().int().nonnegative(),
  pendentes: z.number().int().nonnegative(),
});

export const notaFiscalListItemDTOSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: invoiceStatusSchema,
  statusDescription: z.string().nullable(),
  errorMessage: z.string().nullable(),
  value: z.number(),
  effectiveDate: z.string().nullable(),
  serviceDescription: z.string().nullable(),
  serviceLabel: z.string(),
  pdfUrl: z.string().nullable(),
  xmlUrl: z.string().nullable(),
  cobrancaId: z.string().nullable(),
  chargeId: z.string(),
  cobrancaDescricao: z.string().nullable(),
  alunoId: z.string().nullable(),
  alunoNome: z.string().nullable(),
  syncPending: z.boolean(),
  statusUpdatedAt: z.string(),
});

export const notaFiscalPessoaResumoDTOSchema = z.object({
  id: z.string(),
  tipo: notaFiscalPersonTypeSchema,
  nome: z.string(),
  cpfMasked: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  turmaNome: z.string().nullable(),
  alunosVinculados: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
    }),
  ),
  responsavelPrincipal: z
    .object({
      id: z.string(),
      nome: z.string(),
    })
    .nullable(),
});

export const notaFiscalPessoaDetalheResultDTOSchema = z.object({
  success: z.literal(true),
  data: z.object({
    pessoa: notaFiscalPessoaResumoDTOSchema,
    kpis: notaFiscalKpisDTOSchema,
    notas: z.array(notaFiscalListItemDTOSchema),
  }),
});

export type NotaFiscalPessoaDetalheResultDTO = z.infer<typeof notaFiscalPessoaDetalheResultDTOSchema>;

export const NOTA_FISCAL_STATUS_FILTER_OPTIONS = [
  { value: 'TODOS', label: 'Todos status' },
  { value: 'SCHEDULED', label: 'Aguardando pagamento' },
  { value: 'SYNCHRONIZED', label: 'Enviada à prefeitura' },
  { value: 'AUTHORIZED', label: 'Emitida' },
  { value: 'PROCESSING_CANCELLATION', label: 'Cancelamento em processamento' },
  { value: 'CANCELED', label: 'Cancelada' },
  { value: 'CANCELLATION_DENIED', label: 'Cancelamento negado' },
  { value: 'ERROR', label: 'Erro na emissão' },
] as const;
