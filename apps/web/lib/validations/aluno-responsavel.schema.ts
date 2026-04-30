import { z } from 'zod';

/**
 * Valida CPF brasileiro (apenas dígitos)
 */
function validarCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(digits.charAt(i)) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(digits.charAt(9))) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(digits.charAt(i)) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(digits.charAt(10))) return false;

  return true;
}

/**
 * Calcula idade a partir da data de nascimento
 */
export function calcularIdade(dataNasc: string | Date): number {
  const nasc = typeof dataNasc === 'string' ? new Date(dataNasc) : dataNasc;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade;
}

/**
 * Valida telefone brasileiro (apenas dígitos, 10 ou 11 dígitos)
 */
function validarTelefone(tel: string): boolean {
  const digits = tel.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

/**
 * Schema para cadastro/edição de responsável
 */
export const responsavelSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres').max(100, 'Nome muito longo'),
  cpf: z
    .string()
    .min(1, 'CPF obrigatório')
    .refine((val) => validarCPF(val), 'CPF inválido'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  telefone: z
    .string()
    .min(1, 'Telefone obrigatório')
    .refine((val) => validarTelefone(val), 'Telefone inválido (use 10 ou 11 dígitos)'),
  endereco: z.string().optional(),
  financeiro: z.boolean().default(true),
});

export type ResponsavelFormData = z.infer<typeof responsavelSchema>;

/**
 * Schema para cadastro/edição de aluno
 */
export const alunoSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres').max(100, 'Nome muito longo'),
  dataNasc: z
    .string()
    .min(1, 'Data de nascimento obrigatória')
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, 'Data inválida')
    .refine((val) => {
      const date = new Date(val);
      const hoje = new Date();
      return date < hoje;
    }, 'Data não pode ser futura'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  telefone: z
    .string()
    .optional()
    .refine((val) => !val || validarTelefone(val), 'Telefone inválido'),
  cpf: z
    .string()
    .optional()
    .refine((val) => !val || validarCPF(val), 'CPF inválido'),
  endereco: z.string().optional(),
});

export type AlunoFormData = z.infer<typeof alunoSchema>;

/**
 * Schema combinado: valida se responsável é obrigatório baseado na idade
 * - Menor de idade (< 18): responsável obrigatório
 * - Maior de idade (>= 18): CPF do aluno obrigatório, responsável opcional
 */
export const alunoResponsavelSchema = z
  .object({
    aluno: alunoSchema,
    responsavel: responsavelSchema.optional(),
    adicionarResponsavel: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    const idade = calcularIdade(data.aluno.dataNasc);
    const isMenorDeIdade = idade < 18;

    // Menor de idade: responsável é obrigatório
    if (isMenorDeIdade) {
      const responsavelValido =
        !!data.responsavel && !!data.responsavel.nome && !!data.responsavel.cpf;

      if (!responsavelValido) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Responsável obrigatório para menores de 18 anos',
          path: ['responsavel'],
        });
      }
    }

    // Maior de idade: CPF do aluno é obrigatório
    if (!isMenorDeIdade && !data.aluno.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CPF obrigatório para maiores de 18 anos',
        path: ['aluno', 'cpf'],
      });
    }
  });

export type AlunoResponsavelFormData = z.infer<typeof alunoResponsavelSchema>;
