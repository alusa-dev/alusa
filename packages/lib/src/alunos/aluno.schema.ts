import { z } from 'zod';

// ============================================================================
// VALIDADORES E PREPROCESSORS
// ============================================================================

/**
 * Valida CPF usando algoritmo oficial (mod 11)
 * Aceita CPF com ou sem máscara, normaliza para 11 dígitos
 */
export function isValidCpf(cpf: string): boolean {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return false;
  // Rejeita sequências repetidas (00000000000, 11111111111, etc.)
  if (/^(\d)\1{10}$/.test(cleaned)) return false;
  // Primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cleaned.charAt(i)) * (10 - i);
  let digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  if (digit !== parseInt(cleaned.charAt(9))) return false;
  // Segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cleaned.charAt(i)) * (11 - i);
  digit = 11 - (sum % 11);
  if (digit >= 10) digit = 0;
  return digit === parseInt(cleaned.charAt(10));
}

// Regex para validação de formato (somente dígitos, após normalização)
const cpfRegex = /^\d{11}$/;
const cepRegex = /^\d{8}$/;
const telRegex = /^\d{10,11}$/;

/**
 * Preprocessor: extrai apenas dígitos de uma string
 * Útil para normalizar CPF, CEP, telefone (remove máscara)
 */
const onlyDigits = (v: unknown): unknown => {
  if (typeof v === 'string') {
    const digits = v.replace(/\D/g, '');
    return digits || undefined; // string vazia -> undefined
  }
  return v;
};

/**
 * Preprocessor: converte string vazia ou null para undefined
 * Evita falso "obrigatório" em campos opcionais
 */
const emptyOrNullToUndefined = (v: unknown): unknown => {
  if (v === '' || v === null) return undefined;
  return v;
};

/**
 * Preprocessor: tenta parsear JSON se for string
 * Útil para receber objetos serializados do frontend
 */
const parseJsonIfString = (v: unknown): unknown => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

/**
 * Preprocessor: normaliza CPF (remove máscara + converte vazio para undefined)
 */
const normalizeCpf = (v: unknown): unknown => emptyOrNullToUndefined(onlyDigits(v));

/**
 * Preprocessor: normaliza telefone (remove máscara + converte vazio para undefined)
 */
const normalizeTelefone = (v: unknown): unknown => emptyOrNullToUndefined(onlyDigits(v));

/**
 * Preprocessor: normaliza CEP (remove máscara)
 */
const normalizeCep = (v: unknown): unknown => onlyDigits(v);

// ============================================================================
// SCHEMA DE ENDEREÇO (opcional com validação parcial)
// ============================================================================

/**
 * Schema base de endereço - todos os campos opcionais
 * Valida formato apenas quando valor está presente
 */
export const enderecoSchemaBase = z.object({
  cep: z.preprocess(normalizeCep, z.string().regex(cepRegex, 'CEP deve ter 8 dígitos').optional()),
  logradouro: z.preprocess(emptyOrNullToUndefined, z.string().min(2, 'Logradouro muito curto').optional()),
  numero: z.preprocess(emptyOrNullToUndefined, z.string().min(1, 'Número obrigatório').optional()),
  complemento: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  bairro: z.preprocess(emptyOrNullToUndefined, z.string().min(2, 'Bairro muito curto').optional()),
  cidade: z.preprocess(emptyOrNullToUndefined, z.string().min(2, 'Cidade muito curta').optional()),
  uf: z.preprocess(emptyOrNullToUndefined, z.string().length(2, 'UF deve ter 2 caracteres').optional()),
});

/**
 * Schema de endereço com CEP obrigatório (quando endereço é informado)
 * Usado para validação completa quando há dados
 */
export const enderecoSchema = z.object({
  cep: z.preprocess(normalizeCep, z.string().regex(cepRegex, 'CEP deve ter 8 dígitos')),
  logradouro: z.preprocess(emptyOrNullToUndefined, z.string().min(2).optional()),
  numero: z.preprocess(emptyOrNullToUndefined, z.string().min(1).optional()),
  complemento: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  bairro: z.preprocess(emptyOrNullToUndefined, z.string().min(2).optional()),
  cidade: z.preprocess(emptyOrNullToUndefined, z.string().min(2).optional()),
  uf: z.preprocess(emptyOrNullToUndefined, z.string().length(2).optional()),
});

/**
 * Schema flexível que aceita string JSON e converte para objeto
 * Aceita endereço parcial (todos campos opcionais)
 */
export const enderecoSchemaFlexible = z.preprocess(
  parseJsonIfString,
  enderecoSchemaBase.optional(),
);

// ============================================================================
// SCHEMA DE RESPONSÁVEL
// ============================================================================

/**
 * Schema completo de responsável (quando é obrigatório, ex: menor de idade)
 * CPF, email e telefone são obrigatórios; endereço é opcional
 */
export const responsavelSchema = z.object({
  nome: z.string().min(3, 'Nome deve ter ao menos 3 caracteres'),
  cpf: z
    .preprocess(normalizeCpf, z.string().regex(cpfRegex, 'CPF deve ter 11 dígitos'))
    .refine(isValidCpf, 'CPF inválido'),
  email: z.preprocess(emptyOrNullToUndefined, z.string().email('Email inválido')),
  telefone: z.preprocess(normalizeTelefone, z.string().regex(telRegex, 'Telefone deve ter 10 ou 11 dígitos')),
  endereco: z.preprocess(parseJsonIfString, enderecoSchemaBase).optional(),
  financeiro: z.boolean().default(true).optional(),
});

/**
 * Schema parcial de responsável (quando é opcional, ex: maior de idade)
 * Todos os campos são opcionais mas, se informados, devem ser válidos
 */
export const responsavelSchemaPartial = responsavelSchema.partial();

// ============================================================================
// SCHEMA BASE DO ALUNO
// ============================================================================

export const alunoBaseSchema = z.object({
  contaId: z.string().min(1, 'contaId é obrigatório'),
  nome: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  nomeSocial: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  dataNasc: z.date().refine((d) => d <= new Date(), 'Data de nascimento não pode ser futura'),
  // CPF do aluno é opcional no base (regra condicional no superRefine)
  cpf: z
    .preprocess(normalizeCpf, z.string().regex(cpfRegex, 'CPF deve ter 11 dígitos').optional())
    .refine((val) => !val || isValidCpf(val), 'CPF inválido'),
  email: z.preprocess(emptyOrNullToUndefined, z.string().email('Email inválido').optional()),
  telefone: z.preprocess(normalizeTelefone, z.string().regex(telRegex, 'Telefone deve ter 10 ou 11 dígitos').optional()),
  // Endereço é sempre opcional
  endereco: z.preprocess(parseJsonIfString, enderecoSchemaBase).optional(),
  observacao: z.preprocess(emptyOrNullToUndefined, z.string().max(1000, 'Observação muito longa').optional()),
  foto: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  genero: z
    .preprocess(
      emptyOrNullToUndefined,
      z.enum(['MASCULINO', 'FEMININO', 'NAO_BINARIO', 'OUTRO', 'PREFERE_NAO_INFORMAR']),
    )
    .optional(),
  modalidadePrincipal: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  nivel: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  alergias: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  restricoesMedicas: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  contatoEmergenciaNome: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  contatoEmergenciaTelefone: z.preprocess(normalizeTelefone, z.string().regex(telRegex).optional()),
  origemCadastro: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  bolsaDescontoPercent: z.preprocess(emptyOrNullToUndefined, z.coerce.number().min(0).max(100).optional()),
  isentoTaxaMatricula: z.boolean().optional(),
  consentimentoImagem: z.boolean().optional(),
  dataConsentimentoImagem: z.preprocess(emptyOrNullToUndefined, z.coerce.date().optional()),
  consentimentoComunicacoes: z.boolean().optional(),
  tamanhoCamiseta: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  tamanhoCalcado: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  codigoInterno: z.preprocess(emptyOrNullToUndefined, z.string().optional()),
  tags: z.array(z.string()).optional(),
  status: z.enum(['ATIVO', 'INATIVO']).default('ATIVO').optional(),
  copiarEnderecoResponsavel: z.boolean().optional(),
  // Responsável opcional no base (regra condicional no superRefine)
  responsavel: responsavelSchemaPartial.optional(),
  responsavelExistenteId: z.preprocess(
    emptyOrNullToUndefined,
    z.string().min(1, 'Responsável existente inválido').optional(),
  ),
});

// ============================================================================
// SCHEMA COM REGRAS CONDICIONAIS (superRefine)
// ============================================================================

const alunoRefined = alunoBaseSchema.superRefine((data, ctx) => {
  const idade = calcIdade(data.dataNasc);

  // Validação de bolsa
  if (
    data.bolsaDescontoPercent !== undefined &&
    (data.bolsaDescontoPercent < 0 || data.bolsaDescontoPercent > 100)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['bolsaDescontoPercent'],
      message: 'Bolsa deve estar entre 0 e 100%',
    });
  }

  // ==========================================
  // MAIOR DE IDADE (>= 18 anos)
  // ==========================================
  if (idade >= 18) {
    // CPF do aluno é obrigatório
    if (!data.cpf) {
      ctx.addIssue({
        code: 'custom',
        path: ['cpf'],
        message: 'CPF obrigatório para maior de idade',
      });
    }
    // Responsável é opcional para maior de idade
  }

  // ==========================================
  // MENOR DE IDADE (< 18 anos)
  // ==========================================
  if (idade < 18) {
    if (data.responsavelExistenteId) {
      return;
    }

    // CPF do aluno é opcional (pode ser undefined ou vazio)
    // Responsável é obrigatório com dados completos
    if (!data.responsavel) {
      ctx.addIssue({
        code: 'custom',
        path: ['responsavel'],
        message: 'Responsável obrigatório para menor de idade',
      });
      return; // Não continua validação se responsável ausente
    }

    // Campos obrigatórios do responsável para menor
    const camposObrigatorios: (keyof typeof data.responsavel)[] = ['nome', 'cpf', 'email', 'telefone'];
    for (const campo of camposObrigatorios) {
      if (!data.responsavel[campo]) {
        ctx.addIssue({
          code: 'custom',
          path: ['responsavel', campo],
          message: `${campo.charAt(0).toUpperCase() + campo.slice(1)} do responsável é obrigatório para menor de idade`,
        });
      }
    }
  }
});

// ============================================================================
// SCHEMAS EXPORTADOS
// ============================================================================

export const alunoCreateSchema = alunoRefined;

const enderecoFlexiblePartial = z.preprocess(parseJsonIfString, enderecoSchemaBase);

export const alunoUpdateSchema = alunoBaseSchema.partial().extend({
  id: z.string().min(1, 'ID é obrigatório'),
  foto: z.union([z.preprocess(emptyOrNullToUndefined, z.string()), z.null()]).optional(),
  dataNasc: z.coerce.date().optional(),
  endereco: enderecoFlexiblePartial.optional(),
  motivoInativacao: z.string().optional(),
  dataInativacao: z.coerce.date().optional(),
});

export type AlunoCreateInput = z.infer<typeof alunoCreateSchema>;
export type AlunoUpdateInput = z.infer<typeof alunoUpdateSchema>;

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Calcula idade a partir de uma data de nascimento
 */
export function calcIdade(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 31557600000);
}

/**
 * Formata erros do Zod para retorno padronizado da API
 * Retorna array de { field, message }
 */
export function formatZodErrors(
  issues: Array<{ path: (string | number)[]; message: string }>
): Array<{ field: string; message: string }> {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
