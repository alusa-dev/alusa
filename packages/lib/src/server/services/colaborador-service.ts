import { Prisma, PrismaClient } from '@prisma/client';
import { prisma as shared } from '../../prisma';
import type { ColaboradorInput } from '../../schemas/colaborador';

// Usa singleton compartilhado
const prisma: PrismaClient = shared as unknown as PrismaClient;
// Observação: Enquanto os tipos do Prisma não incluem o modelo Colaborador (antes do generate),
// aplicamos casts leves e desabilitamos a regra lint específica para 'any' nestes pontos.
/* eslint-disable @typescript-eslint/no-explicit-any */

const digits = (v?: string | null) =>
  typeof v === 'string' ? v.replace(/\D/g, '') : (v ?? undefined);
const nullify = (v?: string | null) => (v && v.trim().length > 0 ? v : null);

export async function list(contaId: string) {
  const db = prisma as unknown as { colaborador: any };
  return db.colaborador.findMany({ where: { contaId }, orderBy: { createdAt: 'desc' } });
}

export async function get(id: string, contaId: string) {
  if (!contaId) throw new Error('contaId obrigatório');
  const db = prisma as unknown as { colaborador: any };
  // MULTI-TENANT: filtrar sempre por contaId
  return db.colaborador.findFirst({ where: { id, contaId } });
}

export async function remove(id: string, contaId: string) {
  if (!contaId) throw new Error('contaId obrigatório');
  const db = prisma as unknown as { colaborador: any };
  // MULTI-TENANT: buscar com contaId
  const current = await db.colaborador.findFirst({ where: { id, contaId } });
  if (!current) {
    throw new Error('Colaborador não encontrado');
  }
  if (current.status === 'INATIVO') return current;
  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const result = await db.colaborador.updateMany({
    where: { id, contaId },
    data: {
      status: 'INATIVO',
      dataDesligamento: current.dataDesligamento ?? new Date(),
      temAcesso: false,
    },
  });
  if (result.count === 0) {
    throw new Error('Colaborador não encontrado');
  }
  // Retornar registro atualizado
  return db.colaborador.findFirst({ where: { id, contaId } });
}

export async function create(input: ColaboradorInput & { contaId: string }) {
  const contaIdRaw = typeof input.contaId === 'string' ? input.contaId.trim() : '';
  if (!contaIdRaw) {
    throw new Error('contaId obrigatório');
  }
  const contaId = contaIdRaw;

  // normalizações simples
  const data = {
    contaId,
    nome: input.nome.trim(),
    nomeSocial: nullify(input.nomeSocial) || undefined,
    foto: nullify(input.foto),
    dataNasc: input.dataNasc || undefined,
    genero: input.genero || undefined,
    cpf: digits(input.cpf) || undefined,
    rg: nullify(input.rg) || undefined,
    orgaoEmissor: nullify(input.orgaoEmissor) || undefined,
    dataEmissao: input.dataEmissao || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    telefone1: digits(input.telefone1) || undefined,
    contatoEmergenciaTelefone: digits(input.contatoEmergenciaTelefone) || null,
    enderecoCep: digits(input.enderecoCep) || undefined,
    enderecoLogradouro: nullify(input.enderecoLogradouro) || undefined,
    enderecoNumero: nullify(input.enderecoNumero) || undefined,
    enderecoComplemento: nullify(input.enderecoComplemento) || undefined,
    enderecoBairro: nullify(input.enderecoBairro) || undefined,
    enderecoCidade: nullify(input.enderecoCidade) || undefined,
    enderecoUf: input.enderecoUf || undefined,
    cargo: input.cargo,
    especialidade: nullify(input.especialidade) || undefined,
    status: input.status || 'ATIVO',
    dataAdmissao: input.dataAdmissao || undefined,
    dataDesligamento: input.dataDesligamento || undefined,
    observacoes: nullify(input.observacoes) || undefined,
    // Persistência coerente com Prisma Decimal: enviaremos string com 2 casas
    salario:
      typeof (input as any).salario === 'number'
        ? (Number((input as any).salario).toFixed(2) as unknown as any)
        : undefined,
    temAcesso: input.temAcesso ?? false,
  } as const;

  // Regras básicas
  return prisma.$transaction(async (tx0) => {
    const tx = tx0 as unknown as { colaborador: any; conta: any };
    const conta = await tx.conta.findUnique({ where: { id: contaId } });
    if (!conta) {
      throw new Error(`Conta com ID ${contaId} não encontrada`);
    }

    // Unicidades
    if (data.cpf) {
      const cpfExiste = await tx.colaborador.findFirst({ where: { contaId, cpf: data.cpf } });
      if (cpfExiste) throw new Error('CPF já cadastrado para outro colaborador nesta conta');
    }

    if (data.email) {
      const emailExiste = await tx.colaborador.findFirst({ where: { contaId, email: data.email } });
      if (emailExiste) throw new Error('E-mail já cadastrado para outro colaborador nesta conta');
    }

    // Criar
    try {
      const created = await tx.colaborador.create({ data });

      // Criação automática de Professor quando cargo=PROFESSOR
      // Regras:
      //  - Evita duplicar se já existir professor com mesmo CPF ou email na conta
      //  - Requer campos mínimos obrigatórios do modelo Professor; se ausentes, ignora silenciosamente
      if (data.cargo === 'PROFESSOR') {
        try {
          const profTx = tx as unknown as { professor: any };
          const existing = await profTx.professor.findFirst({
            where: {
              contaId,
              OR: [
                data.cpf ? { cpf: data.cpf } : undefined,
                data.email ? { email: data.email } : undefined,
              ].filter(Boolean),
            },
          });
          const hasMinFields = !!(
            data.nome &&
            data.cpf &&
            data.dataNasc &&
            data.email &&
            data.telefone1
          );
          if (!existing && hasMinFields) {
            await profTx.professor.create({
              data: {
                contaId,
                nome: data.nome,
                cpf: data.cpf,
                dataNasc: data.dataNasc,
                email: data.email,
                telefoneCel: data.telefone1,
                status: 'ATIVO',
              },
            });
          }
        } catch {
          // Falhas na criação do Professor não devem abortar criação do Colaborador.
          // (Ex.: duplicidade de email já existente em Professor). Log silencioso opcional.
          // console.warn('Falha ao criar professor automático:', e);
        }
      }
      return created;
    } catch (err) {
      // Trata duplicidade de forma robusta (concorrência)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = Array.isArray((err as any).meta?.target)
          ? ((err as any).meta?.target as string[]).join(',')
          : String((err as any).meta?.target || '');
        if (target.includes('contaId') && target.includes('cpf')) {
          throw new Error('Já existe um colaborador cadastrado com este CPF');
        }
        if (target.includes('contaId') && target.includes('email')) {
          throw new Error('Já existe um colaborador cadastrado com este e-mail');
        }
      }
      throw err;
    }
  });
}

export async function update(id: string, contaId: string, input: Partial<ColaboradorInput>) {
  if (!id) throw new Error('id obrigatório');
  if (!contaId) throw new Error('contaId obrigatório');

  // proibimos alterar CPF via update para simplificar regras
  const { cpf: _omitCpf, ...rest } = input;
  void _omitCpf; // explicitly ignore unused

  const data: Record<string, unknown> = {};
  if (rest.nome !== undefined) data.nome = (rest.nome ?? '').trim();
  if (rest.foto !== undefined)
    data.foto = rest.foto === null ? null : nullify(rest.foto) || undefined;
  if (rest.dataNasc !== undefined) data.dataNasc = rest.dataNasc || undefined;
  if (rest.genero !== undefined) data.genero = rest.genero || undefined;
  if (rest.nomeSocial !== undefined) data.nomeSocial = nullify(rest.nomeSocial) || undefined;
  if (rest.rg !== undefined) data.rg = nullify(rest.rg) || undefined;
  if (rest.orgaoEmissor !== undefined) data.orgaoEmissor = nullify(rest.orgaoEmissor) || undefined;
  if (rest.dataEmissao !== undefined) data.dataEmissao = rest.dataEmissao || undefined;
  if (rest.email !== undefined)
    data.email = rest.email ? String(rest.email).trim().toLowerCase() : undefined;
  if (rest.telefone1 !== undefined) data.telefone1 = digits(rest.telefone1) || undefined;
  if (rest.contatoEmergenciaTelefone !== undefined)
    data.contatoEmergenciaTelefone = digits(rest.contatoEmergenciaTelefone) || null;
  if (rest.enderecoCep !== undefined) data.enderecoCep = digits(rest.enderecoCep) || undefined;
  if (rest.enderecoLogradouro !== undefined)
    data.enderecoLogradouro = nullify(rest.enderecoLogradouro) || undefined;
  if (rest.enderecoNumero !== undefined)
    data.enderecoNumero = nullify(rest.enderecoNumero) || undefined;
  if (rest.enderecoComplemento !== undefined)
    data.enderecoComplemento = nullify(rest.enderecoComplemento) || undefined;
  if (rest.enderecoBairro !== undefined)
    data.enderecoBairro = nullify(rest.enderecoBairro) || undefined;
  if (rest.enderecoCidade !== undefined)
    data.enderecoCidade = nullify(rest.enderecoCidade) || undefined;
  if (rest.enderecoUf !== undefined) data.enderecoUf = rest.enderecoUf || undefined;
  if (rest.cargo !== undefined) data.cargo = rest.cargo;
  if (rest.especialidade !== undefined)
    data.especialidade = nullify(rest.especialidade) || undefined;
  if (rest.status !== undefined) data.status = rest.status;
  if (rest.dataAdmissao !== undefined) data.dataAdmissao = rest.dataAdmissao || undefined;
  if (rest.dataDesligamento !== undefined)
    data.dataDesligamento = rest.dataDesligamento || undefined;
  if (rest.observacoes !== undefined) data.observacoes = nullify(rest.observacoes) || undefined;
  if ((rest as any).salario !== undefined) {
    const v = (rest as any).salario;
    data.salario = typeof v === 'number' && !Number.isNaN(v) ? Number(v).toFixed(2) : undefined;
  }
  if (rest.temAcesso !== undefined) data.temAcesso = rest.temAcesso ?? false;

  // unicidade de email quando alterado
  return prisma.$transaction(async (tx0) => {
    const tx = tx0 as unknown as { colaborador: any };
    if (data.email) {
      const exists = await tx.colaborador.findFirst({ where: { contaId, email: data.email } });
      if (exists && exists.id !== id)
        throw new Error('E-mail já cadastrado para outro colaborador nesta conta');
    }
    // MULTI-TENANT: usar updateMany para operação atômica com contaId
    const result = await tx.colaborador.updateMany({ where: { id, contaId }, data });
    if (result.count === 0) {
      throw new Error('Colaborador não encontrado');
    }
    // Retornar registro atualizado
    return tx.colaborador.findFirst({ where: { id, contaId } });
  });
}
