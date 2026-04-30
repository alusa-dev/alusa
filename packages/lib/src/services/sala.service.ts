import { prisma } from '../prisma';
import { salaSchema } from '../schemas/sala.schema';
import type { Sala } from '@prisma/client';

export interface SalaListOptions {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: 'ATIVO' | 'INATIVO';
}

export async function createSala(input: {
  contaId: string;
  nome: string;
  descricao?: string;
  capacidade: number;
  status?: 'ATIVO' | 'INATIVO';
}): Promise<Sala> {
  const parsed = salaSchema.parse({
    nome: input.nome?.trim(),
    descricao: input.descricao?.trim() || undefined,
    capacidade: input.capacidade,
    status: input.status,
  });
  // Garantir existência da conta para qualquer contaId, não só conta-default
  const existingConta = await prisma.conta.findUnique({ where: { id: input.contaId } });
  if (!existingConta) {
    if (process.env.NODE_ENV !== 'production') {
      await prisma.conta.create({
        data: {
          id: input.contaId,
          nome: 'Conta Auto (Dev) ' + input.contaId.substring(0, 6),
          cpfCnpj: '00000000000000',
          status: 'ATIVO',
        },
      });
    } else {
      throw new Error('Conta não encontrada para criar sala');
    }
  }

  const exists = await prisma.sala.findFirst({
    where: { contaId: input.contaId, nome: parsed.nome },
  });
  if (exists) throw new Error('Já existe uma sala com este nome nesta conta');
  try {
    return await prisma.sala.create({
      data: {
        contaId: input.contaId,
        nome: parsed.nome,
        descricao: parsed.descricao,
        capacidade: parsed.capacidade,
        status: parsed.status ?? 'ATIVO',
      },
    });
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err && 'code' in err ? (err as { code?: string }).code : undefined;
    if (process.env.NODE_ENV !== 'production') console.error('[createSala] erro', err);
    if (code === 'P2002') throw new Error('Já existe uma sala com este nome nesta conta');
    if (code === 'P2003') throw new Error('Falha de integridade: conta vinculada não existe');
    throw err;
  }
}

export async function updateSala(input: {
  id: string;
  contaId: string;
  nome?: string;
  descricao?: string;
  capacidade?: number;
  status?: 'ATIVO' | 'INATIVO';
}): Promise<Sala> {
  const current = await prisma.sala.findFirst({ where: { id: input.id, contaId: input.contaId } });
  if (!current) throw new Error('Sala não encontrada');
  const merged = {
    nome: input.nome ?? current.nome,
    descricao: input.descricao ?? current.descricao ?? undefined,
    capacidade: input.capacidade ?? current.capacidade,
    status: (input.status ?? current.status) as 'ATIVO' | 'INATIVO',
  };
  const parsed = salaSchema.parse(merged);
  if (parsed.nome !== current.nome) {
    const dup = await prisma.sala.findFirst({
      where: { contaId: input.contaId, nome: parsed.nome, id: { not: input.id } },
    });
    if (dup) throw new Error('Já existe uma sala com este nome nesta conta');
  }
  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const result = await prisma.sala.updateMany({
    where: { id: input.id, contaId: input.contaId },
    data: {
      nome: parsed.nome,
      descricao: parsed.descricao,
      capacidade: parsed.capacidade,
      status: parsed.status ?? current.status,
    },
  });
  if (result.count === 0) {
    throw new Error('Sala não encontrada');
  }
  // Retornar registro atualizado
  const updated = await prisma.sala.findFirst({ where: { id: input.id, contaId: input.contaId } });
  if (!updated) throw new Error('Sala não encontrada');
  return updated;
}

export async function listSalas(contaId: string, opts: SalaListOptions = {}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
  const where: Record<string, unknown> = { contaId };
  if (opts.q) where.nome = { contains: opts.q, mode: 'insensitive' };
  if (opts.status) where.status = opts.status;
  const [data, total] = await Promise.all([
    prisma.sala.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.sala.count({ where }),
  ]);
  return { data, page, pageSize, total };
}

export async function deleteSala(id: string, contaId: string): Promise<Sala> {
  const current = await prisma.sala.findFirst({ where: { id, contaId } });
  if (!current) throw new Error('Sala não encontrada');
  // MULTI-TENANT: usar deleteMany para operação atômica com contaId
  const result = await prisma.sala.deleteMany({ where: { id, contaId } });
  if (result.count === 0) {
    throw new Error('Sala não encontrada');
  }
  return current; // retorna registro anterior para logging se necessário
}
