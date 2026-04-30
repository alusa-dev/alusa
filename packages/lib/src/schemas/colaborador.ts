import { z } from 'zod';
import '../zod-error-map';

// Converte strings BR "dd/MM/yyyy" em Date segura, senão retorna undefined
function parseDateBr(input: unknown): Date | undefined {
  if (input == null) return undefined;
  if (typeof input !== 'string') return undefined;
  const v = input.trim();
  if (!v) return undefined;
  // dd/MM/yyyy
  const m = v.match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{4})$/);
  if (!m) return undefined;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  const d = new Date(yyyy, mm - 1, dd);
  // valida consistência (ex.: 31/02 inválida)
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return undefined;
  return d;
}

export const generoEnum = z.enum([
  'MASCULINO',
  'FEMININO',
  'NAO_BINARIO',
  'OUTRO',
  'PREFERE_NAO_INFORMAR',
]);
export const cargoEnum = z.enum(['PROFESSOR', 'RECEPCAO', 'FINANCEIRO', 'ADMINISTRATIVO', 'OUTRO']);
export const statusColabEnum = z.enum(['ATIVO', 'INATIVO']);

// Helpers de CPF
const onlyDigits = (s: string) => s.replace(/\D/g, '');
const isValidCPF = (cpf: string) => {
  const c = onlyDigits(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false; // todos iguais
  const calc = (base: string, factor: number) => {
    let total = 0;
    for (let i = 0; i < base.length; i++) total += parseInt(base[i]!, 10) * (factor - i);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(c.substring(0, 9), 10);
  const d2 = calc(c.substring(0, 10), 11);
  return d1 === parseInt(c[9]!, 10) && d2 === parseInt(c[10]!, 10);
};
const cpfRegex = /^(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/;
// Telefone BR: exigir 11 dígitos (DDD + 9 + número), ignorando máscara/formatação
const telefoneDigitsRegex = /^\d{11}$/;
const cepRegex = /^(\d{5}-?\d{3})$/;

export const colaboradorSchema = z
  .object({
    // Identificação
    foto: z
      .union([
        z.string().url(),
        // data URL base64 ex.: data:image/png;base64,AAA...
        z.string().regex(/^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+$/, 'Foto inválida'),
        z.literal(''),
      ])
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
    nome: z.string().min(2, 'Informe o nome completo'),
    // nomeSocial opcional: aceita string vazia e normaliza para undefined
    nomeSocial: z
      .union([z.string().min(2), z.literal(''), z.null(), z.undefined()])
      .transform((v) => (v === '' || v == null ? undefined : v))
      .optional(),
    // Data de nascimento: aceita vazio; aceita string dd/MM/yyyy; converte para Date
    dataNasc: z
      .preprocess((v) => {
        if (v === '' || v == null) return undefined;
        const d = parseDateBr(v);
        return d ?? v;
      }, z.coerce.date())
      .optional()
      .nullable(),
    genero: generoEnum.optional().nullable(),

    // Documentos
    // CPF opcional: aceita vazio, mas quando informado valida formato e dígitos
    cpf: z
      .preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        z
          .string()
          .regex(cpfRegex, 'CPF inválido')
          .transform(onlyDigits)
          .refine(isValidCPF, 'CPF inválido'),
      )
      .optional(),
    rg: z.string().optional().nullable(),
    orgaoEmissor: z.string().optional().nullable(),
    dataEmissao: z.coerce.date().optional().nullable(),

    // Contato
    // E-mail/Telefone: aceitam vazio (tratado como undefined), mas serão exigidos no superRefine
    email: z
      .preprocess(
        (v) => (v === '' || v == null ? undefined : v),
        z.string().email('E-mail inválido'),
      )
      .optional()
      .nullable(),
    telefone1: z
      .preprocess(
        (v) => {
          if (v === '' || v == null) return undefined;
          return String(v).replace(/\D/g, '');
        },
        z.string().regex(telefoneDigitsRegex, 'Telefone inválido'),
      )
      .optional()
      .nullable(),
    contatoEmergenciaTelefone: z
      .preprocess(
        (v) => {
          if (v === '' || v == null) return undefined;
          return String(v).replace(/\D/g, '');
        },
        z.string().regex(telefoneDigitsRegex, 'Telefone inválido'),
      )
      .optional()
      .nullable(),

    // Endereço
    // CEP obrigatório
    enderecoCep: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      z.string().regex(cepRegex, 'CEP inválido'),
    ),
    enderecoLogradouro: z.string().optional().nullable(),
    enderecoNumero: z.string().optional().nullable(),
    enderecoComplemento: z.string().optional().nullable(),
    enderecoBairro: z.string().optional().nullable(),
    enderecoCidade: z.string().optional().nullable(),
    // UF opcional (2 letras quando preenchida)
    enderecoUf: z
      .preprocess((v) => (v === '' || v == null ? undefined : v), z.string().length(2))
      .optional()
      .nullable(),

    // Vínculo
    cargo: cargoEnum,
    especialidade: z.string().max(120, 'Máximo 120 caracteres').optional().nullable(),
    status: statusColabEnum.default('ATIVO'),
    dataAdmissao: z
      .preprocess((v) => {
        if (v === '' || v == null) return undefined;
        const d = parseDateBr(v);
        return d ?? v;
      }, z.coerce.date())
      .optional()
      .nullable(),
    dataDesligamento: z
      .preprocess((v) => {
        if (v === '' || v == null) return undefined;
        const d = parseDateBr(v);
        return d ?? v;
      }, z.coerce.date())
      .optional()
      .nullable(),
    observacoes: z.string().optional().nullable(),
    salario: z
      .union([
        z.coerce.number().nonnegative('Valor inválido'),
        // aceita string mascarada BRL como "1.234,56" e converte para número
        z
          .string()
          .min(1)
          .transform((s) => Number(s.replace(/\./g, '').replace(',', '.')))
          .refine((n) => !Number.isNaN(n) && n >= 0, 'Valor inválido'),
        z.null(),
        z.undefined(),
      ])
      .transform((v) => (typeof v === 'number' ? v : (v ?? undefined)))
      .optional(),

    // Acesso
    temAcesso: z.boolean().default(false),
    roleUsuario: z.enum(['ADMIN', 'FINANCEIRO', 'RECEPCAO', 'PROFESSOR']).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    // Regras de obrigatoriedade com mensagens em português
    if (!val.dataNasc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataNasc'],
        message: 'Informe a data de nascimento',
      });
    }
    if (!val.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Informe o e-mail' });
    }
    if (!val.telefone1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['telefone1'],
        message: 'Informe o telefone',
      });
    }
    if (val.dataAdmissao && val.dataDesligamento && val.dataDesligamento < val.dataAdmissao) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataDesligamento'],
        message: 'Data de desligamento anterior à admissão',
      });
    }
    if (val.temAcesso && !val.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'E-mail é obrigatório para acesso ao sistema',
      });
    }
  });

export type ColaboradorInput = z.infer<typeof colaboradorSchema>;
