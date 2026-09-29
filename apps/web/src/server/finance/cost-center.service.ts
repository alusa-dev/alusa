import { prisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';
import type {
  CentroCustoInputDTO,
  CentroCustoQueryDTO,
  CentroCustoStatusInputDTO,
} from '@/features/finance/operations/cost-centers/dtos';

type CostCenterDb = Pick<PrismaClient, 'centroCusto'>;
type CostCenterWriteInput = Omit<CentroCustoInputDTO, 'status'> & {
  status?: 'ATIVO' | 'INATIVO';
};

export async function listCostCenters(
  contaId: string,
  filters: CentroCustoQueryDTO,
  db: CostCenterDb = prisma,
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

export async function getCostCenter(
  contaId: string,
  id: string,
  db: CostCenterDb = prisma,
) {
  return db.centroCusto.findFirst({
    where: { id, contaId },
    include: { _count: { select: { lancamentos: true } } },
  });
}

export async function findDuplicateCostCenter(
  contaId: string,
  input: Pick<CentroCustoInputDTO, 'nome' | 'tipo'>,
  excludeId?: string,
  db: CostCenterDb = prisma,
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

export async function createCostCenter(
  contaId: string,
  input: CostCenterWriteInput,
  db: CostCenterDb = prisma,
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

export async function updateCostCenter(
  contaId: string,
  id: string,
  input: CostCenterWriteInput,
  currentStatus: 'ATIVO' | 'INATIVO',
  db: CostCenterDb = prisma,
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

export async function updateCostCenterStatus(
  contaId: string,
  id: string,
  input: CentroCustoStatusInputDTO,
  db: CostCenterDb = prisma,
) {
  return db.centroCusto.updateMany({
    where: { id, contaId },
    data: { status: input.status },
  });
}

export async function deleteCostCenter(
  contaId: string,
  id: string,
  db: CostCenterDb = prisma,
) {
  return db.centroCusto.deleteMany({ where: { id, contaId } });
}
