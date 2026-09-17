import { prisma } from '@/lib/prisma';

const descontoSelect = {
  id: true,
  nome: true,
  tipo: true,
  valor: true,
  escopo: true,
  status: true,
} as const;

export async function listActiveDescontos(contaId: string) {
  return prisma.desconto.findMany({
    where: { contaId, status: 'ATIVO' },
    orderBy: { nome: 'asc' },
    select: descontoSelect,
  });
}

export async function createDesconto(input: {
  contaId: string;
  nome: string;
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
}) {
  return prisma.desconto.create({
    data: {
      contaId: input.contaId,
      nome: input.nome,
      tipo: input.tipo,
      valor: input.valor,
      escopo: 'MATRICULA',
      status: 'ATIVO',
    },
    select: descontoSelect,
  });
}
