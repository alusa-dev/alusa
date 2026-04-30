import { z } from 'zod';

// Util helpers
const digits = (v: string) => v.replace(/\D/g, '');
const today = new Date();
const MIN_DATE = new Date('1900-01-01');

export const statusEnum = z.enum(['ATIVO','INATIVO']);
export const generoEnum = z.enum(['MASCULINO','FEMININO','NAO_BINARIO','OUTRO','PREFERE_NAO_INFORMAR']).optional().nullable();

// Responsável (condicional)
export const responsavelSchema = z.object({
  // Campos obrigatórios para sincronização Asaas
  nome: z.string().min(2, 'Nome do responsável obrigatório'),
  cpf: z.string().min(1, 'CPF obrigatório').transform(digits).refine(v => v.length === 11, 'CPF inválido'),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().min(1, 'Telefone obrigatório').transform(digits).refine(v => v.length >= 10 && v.length <= 11, 'Telefone inválido'),
  enderecoCep: z.string().min(1, 'CEP obrigatório').transform(digits).refine(v => v.length === 8, 'CEP inválido'),
  // Demais campos de endereço podem ser preenchidos pela consulta ViaCEP ou manualmente
  enderecoLogradouro: z.string().optional(),
  enderecoNumero: z.string().optional(),
  enderecoComplemento: z.string().optional(),
  enderecoBairro: z.string().optional(),
  enderecoCidade: z.string().optional(),
  enderecoUf: z.string().regex(/^[A-Z]{2}$/i, 'UF inválida').optional(),
  financeiro: z.boolean().optional().default(false),
}).strict();

// Shape base (sem superRefine) para permitir derivar .partial()
const alunoShape = {
  // No wizard usamos um ID de conta sintético em ambiente local de testes; retirar restrição de CUID
  contaId: z.string(),
  // Campos obrigatórios (Asaas): nome completo, data de nascimento, CEP, email, telefone
  nome: z.string().min(2, 'Nome obrigatório'),
  nomeSocial: z.string().nullable().optional(),
  dataNasc: z.coerce.date().refine(d => d >= MIN_DATE && d < today, 'Data de nascimento inválida'),
  // CPF opcional para -18 anos, obrigatório para +18 (validado no superRefine)
  cpf: z.string().optional().transform(v => v ? digits(v) : '').refine(v => !v || v.length === 11, 'CPF inválido'),
  email: z.string().email('E-mail inválido'),
  telefone: z.string().min(1, 'Telefone obrigatório').transform(digits).refine(v => v.length >= 10 && v.length <= 11, 'Telefone inválido'),
  status: statusEnum.default('ATIVO'),

  // Endereço
  enderecoCep: z.string().min(1, 'CEP obrigatório').transform(digits).refine(v => v.length === 8, 'CEP inválido'),
  enderecoLogradouro: z.string().nullable().optional(),
  enderecoNumero: z.string().nullable().optional(),
  enderecoComplemento: z.string().nullable().optional(),
  enderecoBairro: z.string().nullable().optional(),
  enderecoCidade: z.string().nullable().optional(),
  enderecoUf: z.string().nullable().optional().refine(v => !v || /^[A-Z]{2}$/i.test(v), 'UF inválida'),

  observacao: z.string().max(2000, 'Máx 2000 caracteres').nullable().optional(),
  genero: generoEnum,
  alergias: z.string().max(1000).nullable().optional(),
  restricoesMedicas: z.string().max(1000).nullable().optional(),
  contatoEmergenciaNome: z.string().nullable().optional(),
  contatoEmergenciaTelefone: z.string().transform(v => v ? digits(v) : v).nullable().optional().refine(v => !v || (v.length >= 10 && v.length <= 11), 'Telefone emergência inválido'),
  // Campos adicionais de perfil / classificação
  // codigoInterno removido do input do wizard (gerado automaticamente no backend). Mantemos no patch para exibição futura.
  modalidadePrincipal: z.string().max(60, 'Máx 60 caracteres').nullable().optional(),
  nivel: z.string().max(60, 'Máx 60 caracteres').nullable().optional(),
  origemCadastro: z.string().max(60, 'Máx 60 caracteres').nullable().optional(),
  tamanhoCamiseta: z.string().regex(/^(PP|P|M|G|GG|XG)$/i, 'Tamanho inválido').nullable().optional(),
  tamanhoCalcado: z.string().nullable().optional().refine(v => !v || /^[0-9]{2,3}$/.test(v), 'Calçado inválido'),
  consentimentoImagem: z.boolean().optional().default(false),
  dataConsentimentoImagem: z.coerce.date().optional().nullable(),
  consentimentoComunicacoes: z.boolean().optional().default(true),
  tags: z
    .union([z.array(z.string().min(1).max(30)), z.string()])
    .optional()
    .transform((v) => {
      if (!v) return [] as string[];
      if (Array.isArray(v)) return v.map(s => s.trim()).filter(Boolean);
      return v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }),

  // Responsável condicional
  responsavel: responsavelSchema.nullable().optional(),
};

export const alunoBaseSchema = z.object(alunoShape);
export const alunoSchema = alunoBaseSchema.superRefine((data, ctx) => {
  const dataNasc = data.dataNasc as Date | undefined;
  if (!(dataNasc instanceof Date)) return; // fallback de segurança
  const diff = today.getTime() - dataNasc.getTime();
  const age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  // Aluno -18: responsável obrigatório (com CPF); Aluno +18: CPF do aluno obrigatório
  if (age < 18 && !data.responsavel) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['responsavel'], message: 'Responsável obrigatório para menor de idade' });
  }
  if (age >= 18 && (!data.cpf || data.cpf.length !== 11)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cpf'], message: 'CPF obrigatório para maior de idade' });
  }
  if (data.contatoEmergenciaTelefone && !data.contatoEmergenciaNome) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contatoEmergenciaNome'], message: 'Nome do contato de emergência obrigatório' });
  }
  if (data.contatoEmergenciaNome && !data.contatoEmergenciaTelefone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contatoEmergenciaTelefone'], message: 'Telefone do contato de emergência obrigatório' });
  }
  if (data.consentimentoImagem && !data.dataConsentimentoImagem) {
    // Auto-preencher data de consentimento se não fornecida
    // Não gera erro; apenas define.
    // (Mutação intencional do objeto validado.)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    data.dataConsentimentoImagem = new Date();
  }
});

export type AlunoInput = z.infer<typeof alunoSchema>;

export const alunoPatchSchema = alunoBaseSchema.partial().extend({ id: z.string().cuid() });
export type AlunoPatchInput = z.infer<typeof alunoPatchSchema>;
