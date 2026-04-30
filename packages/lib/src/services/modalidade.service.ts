import { prisma } from '../prisma';
import { modalidadeSchema } from '../schemas/modalidade.schema';
import type { Modalidade } from '@prisma/client';

export interface ModalidadeListOptions {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
}

export async function createModalidade(input: {
  contaId: string;
  nome: string;
  descricao?: string;
  status?: string;
}): Promise<Modalidade> {
  // Normaliza e valida
  const parsed = modalidadeSchema.parse({
    nome: input.nome?.trim(),
    descricao: input.descricao?.trim() || undefined,
    status: input.status,
  });
  // Garante existência da conta (antes só tratava conta-default). Se a conta não existir:
  // - Em desenvolvimento criamos automaticamente (facilita fluxos de teste rápidos / seeds parciais)
  // - Em produção retornamos erro explícito
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
      throw new Error('Conta não encontrada para criar modalidade');
    }
  }

  // Verifica duplicidade (case sensitive por enquanto)
  const exists = await prisma.modalidade.findFirst({
    where: { contaId: input.contaId, nome: parsed.nome },
  });
  if (exists) throw new Error('Já existe uma modalidade com este nome nesta conta');

  try {
    return await prisma.modalidade.create({
      data: {
        contaId: input.contaId,
        nome: parsed.nome,
        descricao: parsed.descricao,
        status: parsed.status ?? 'ATIVO',
      },
    });
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err && 'code' in err ? (err as { code?: string }).code : undefined;
    if (process.env.NODE_ENV !== 'production') console.error('[createModalidade] erro', err);
    if (code === 'P2002') {
      // unique constraint (duplicidade)
      throw new Error('Já existe uma modalidade com este nome nesta conta');
    }
    if (code === 'P2003') {
      // FK
      throw new Error('Falha de integridade: conta vinculada não existe');
    }
    throw err;
  }
}

export async function updateModalidade(input: {
  id: string;
  contaId: string;
  nome?: string;
  descricao?: string;
  status?: string;
}): Promise<Modalidade> {
  const current = await prisma.modalidade.findFirst({
    where: { id: input.id, contaId: input.contaId },
  });
  if (!current) throw new Error('Modalidade não encontrada');
  const merged = {
    nome: input.nome ?? current.nome,
    descricao: input.descricao ?? current.descricao ?? undefined,
    status: (input.status ?? current.status) as string,
  };
  const parsed = modalidadeSchema.parse(merged);
  if (parsed.nome !== current.nome) {
    const dup = await prisma.modalidade.findFirst({
      where: { contaId: input.contaId, nome: parsed.nome, id: { not: input.id } },
    });
    if (dup) throw new Error('Já existe uma modalidade com este nome nesta conta');
  }
  // MULTI-TENANT: usar updateMany para operação atômica com contaId
  const result = await prisma.modalidade.updateMany({
    where: { id: input.id, contaId: input.contaId },
    data: {
      nome: parsed.nome,
      descricao: parsed.descricao,
      status: parsed.status ?? current.status,
    },
  });
  if (result.count === 0) {
    throw new Error('Modalidade não encontrada');
  }
  // Retornar registro atualizado
  const updated = await prisma.modalidade.findFirst({ where: { id: input.id, contaId: input.contaId } });
  if (!updated) throw new Error('Modalidade não encontrada');
  return updated;
}

export async function listModalidades(contaId: string, opts: ModalidadeListOptions = {}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
  const where: Record<string, unknown> = { contaId };
  if (opts.q) where.nome = { contains: opts.q, mode: 'insensitive' };
  if (opts.status) where.status = opts.status;
  const [data, total] = await Promise.all([
    prisma.modalidade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.modalidade.count({ where }),
  ]);
  return { data, page, pageSize, total };
}

export async function deleteModalidade(id: string, contaId: string): Promise<Modalidade> {
  const current = await prisma.modalidade.findFirst({ where: { id, contaId } });
  if (!current) throw new Error('Modalidade não encontrada');
  // MULTI-TENANT: usar deleteMany para operação atômica com contaId
  const result = await prisma.modalidade.deleteMany({ where: { id, contaId } });
  if (result.count === 0) {
    throw new Error('Modalidade não encontrada');
  }
  return current; // retorna estado anterior para fins de auditoria/log se necessário
}
