import { z } from 'zod';

// Helpers
const onlyDigits = (s: string) => s.replace(/\D/g, '');
const isValidCPF = (cpf: string) => {
  const c = onlyDigits(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;
  // dígitos verificadores
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

const isAdult = (d: Date) => {
  const today = new Date();
  const age = today.getFullYear() - d.getFullYear() - (today < new Date(d.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
  return age >= 18;
};

export const statusSchema = z.enum(['ATIVO', 'INATIVO']);
export const statusContratualSchema = z.enum(['EFETIVO','TEMPORARIO','PRESTADOR','VOLUNTARIO']);

export const professorBaseSchema = z.object({
  contaId: z.string().cuid({ message: 'contaId inválido' }).optional(), // apenas no create via body conforme requisito
  nome: z.string().trim().min(3, 'Nome deve ter pelo menos 3 caracteres'),
  cpf: z.string().trim().transform(onlyDigits).refine(isValidCPF, 'CPF inválido'),
  rg: z.string().trim().optional().or(z.literal('')),
  dataNasc: z.coerce.date({ invalid_type_error: 'Data de nascimento inválida' }).refine(isAdult, 'Professor deve ter 18 anos ou mais'),
  sexo: z.string().trim().optional(),
  estadoCivil: z.string().trim().optional(),
  nacionalidade: z.string().trim().optional(),

  email: z.string().trim().email('E-mail inválido'),
  telefoneCel: z.string().trim().min(10, 'Telefone celular obrigatório'),
  telefoneFixo: z.string().trim().optional(),

  cep: z.string().trim().optional(),
  logradouro: z.string().trim().optional(),
  numero: z.string().trim().optional(),
  complemento: z.string().trim().optional(),
  bairro: z.string().trim().optional(),
  cidade: z.string().trim().optional(),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras').optional(),

  formacao: z.string().trim().optional(),
  especialidades: z.array(z.string().trim()).default([]),
  dataAdmissao: z.coerce.date().optional(),
  statusContratual: statusContratualSchema.optional(),
  cargaHoraria: z.coerce.number().int().positive('Carga horária deve ser positiva').optional(),
  miniBio: z.string().trim().optional(),
  foto: z.string().url('URL de foto inválida').optional(),

  status: statusSchema.default('ATIVO'),
});

export const professorCreateSchema = professorBaseSchema.extend({
  contaId: z.string().cuid({ message: 'contaId inválido' }),
});

export const professorUpdateSchema = professorBaseSchema.partial().extend({
  cpf: z.never().optional(), // proibido alterar via PUT
  email: z.string().email().optional(), // proibido alterar (checado na API)
});

export type ProfessorCreateDTO = z.infer<typeof professorCreateSchema>;
export type ProfessorUpdateDTO = z.infer<typeof professorUpdateSchema>;
