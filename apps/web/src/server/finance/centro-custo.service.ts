import { prisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';
import type {
  CentroCustoInputDTO,
  CentroCustoQueryDTO,
  CentroCustoStatusInputDTO,
} from '@/features/financeiro/centros-custo/dtos';

type CentroCustoDb = Pick<PrismaClient, 'centroCusto'>;
type CentroCustoWriteInput = Omit<CentroCustoInputDTO, 'status'> & {
  status?: 'ATIVO' | 'INATIVO';
};

export async function listCentroCustos(
  contaId: string,
  filters: CentroCustoQueryDTO,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.findMany({
    where: {
      contaId,
      ...(filters.tipo ? { tipo: filters.tipo } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: [{ nome: 'asc' }],
    include: { _count: { select: { lancamentos: true } } },
  });
}

export async function getCentroCusto(
  contaId: string,
  id: string,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.findFirst({
    where: { id, contaId },
    include: { _count: { select: { lancamentos: true } } },
  });
}

export async function findDuplicateCentroCusto(
  contaId: string,
  input: Pick<CentroCustoInputDTO, 'nome' | 'tipo'>,
  excludeId?: string,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.findFirst({
    where: {
      contaId,
      nome: input.nome,
      tipo: input.tipo,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
}

export async function createCentroCusto(
  contaId: string,
  input: CentroCustoWriteInput,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.create({
    data: {
      contaId,
      nome: input.nome,
      tipo: input.tipo,
      descricao: input.descricao ?? null,
      status: input.status ?? 'ATIVO',
    },
  });
}

export async function updateCentroCusto(
  contaId: string,
  id: string,
  input: CentroCustoWriteInput,
  currentStatus: 'ATIVO' | 'INATIVO',
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.updateMany({
    where: { id, contaId },
    data: {
      nome: input.nome,
      tipo: input.tipo,
      descricao: input.descricao ?? null,
      status: input.status ?? currentStatus,
    },
  });
}

export async function updateCentroCustoStatus(
  contaId: string,
  id: string,
  input: CentroCustoStatusInputDTO,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.updateMany({
    where: { id, contaId },
    data: { status: input.status },
  });
}

export async function deleteCentroCusto(
  contaId: string,
  id: string,
  db: CentroCustoDb = prisma,
) {
  return db.centroCusto.deleteMany({ where: { id, contaId } });
}
