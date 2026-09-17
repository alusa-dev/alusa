import { prisma } from '@/lib/prisma';

type ColaboradorRecord = Record<string, unknown>;

type ColaboradorClient = {
  findMany(args: unknown): Promise<ColaboradorRecord[]>;
  findFirst(args: unknown): Promise<ColaboradorRecord | null>;
};

const colaborador = (prisma as unknown as { colaborador: ColaboradorClient }).colaborador;

export async function listColaboradores(input: {
  contaId: string;
  search?: string;
  status?: string;
  cargo?: string;
  page: number;
  pageSize: number;
}) {
  const and: Array<Record<string, unknown>> = [];
  if (input.search) {
    and.push({
      OR: [
        { nome: { contains: input.search, mode: 'insensitive' } },
        { email: { contains: input.search, mode: 'insensitive' } },
      ],
    });
  }
  if (input.status) and.push({ status: input.status });
  if (input.cargo) and.push({ cargo: input.cargo });

  const where = {
    contaId: input.contaId,
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const [total, items] = await Promise.all([
    (prisma as unknown as { colaborador: { count(args: unknown): Promise<number> } }).colaborador.count({
      where,
    }),
    colaborador.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return { items, total };
}

export async function getColaborador(input: { contaId: string; id: string }) {
  return colaborador.findFirst({ where: { id: input.id, contaId: input.contaId } });
}
