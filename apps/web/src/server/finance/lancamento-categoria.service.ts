import { prisma } from '@/lib/prisma';
import type { TipoLancamento } from '@prisma/client';

export function listLancamentoCategorias(input: { contaId: string; tipo?: TipoLancamento }) {
  return prisma.categoriaLancamento.findMany({
    where: { contaId: input.contaId, ...(input.tipo ? { tipo: input.tipo } : {}) },
    orderBy: [{ parentId: 'asc' }, { nome: 'asc' }],
  });
}

export async function createLancamentoCategoria(input: {
  contaId: string;
  nome: string;
  tipo: TipoLancamento;
  parentId?: string | null;
}) {
  const normalizedName = input.nome.trim();
  if (input.parentId) {
    const parent = await prisma.categoriaLancamento.findFirst({
      where: { id: input.parentId, contaId: input.contaId, tipo: input.tipo },
    });
    if (!parent) return { kind: 'INVALID_PARENT' as const };
  }

  const existing = await prisma.categoriaLancamento.findFirst({
    where: { contaId: input.contaId, tipo: input.tipo, nome: normalizedName, parentId: input.parentId ?? null },
  });
  if (existing) return { kind: 'DUPLICATE' as const };

  const created = await prisma.categoriaLancamento.create({
    data: { contaId: input.contaId, nome: normalizedName, tipo: input.tipo, parentId: input.parentId ?? null },
  });
  return { kind: 'CREATED' as const, value: created };
}
