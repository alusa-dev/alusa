import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  AgendaOperationLogDTO,
  AulasOperationLogLevelDTO,
  ListAgendaOperationLogsResultDTO,
} from '@/features/aulas/dtos';
import { prisma } from '@/src/prisma';

type CreateAulasOperationLogParams = {
  contaId: string;
  action: string;
  message: string;
  level?: AulasOperationLogLevelDTO;
  entityType?: string | null;
  entityId?: string | null;
  details?: unknown;
  prismaClient?: PrismaClient | Prisma.TransactionClient;
};

function mapLogItem(item: {
  id: string;
  level: AulasOperationLogLevelDTO;
  action: string;
  entityType: string | null;
  entityId: string | null;
  message: string;
  details: unknown;
  createdAt: Date;
}): AgendaOperationLogDTO {
  return {
    id: item.id,
    level: item.level,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    message: item.message,
    details: item.details ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function createAulasOperationLog({
  contaId,
  action,
  message,
  level = 'INFO',
  entityType,
  entityId,
  details,
  prismaClient = prisma,
}: CreateAulasOperationLogParams) {
  const created = await prismaClient.aulasOperationLog.create({
    data: {
      contaId,
      level,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      message,
      details: details ?? undefined,
    },
    select: {
      id: true,
      level: true,
      action: true,
      entityType: true,
      entityId: true,
      message: true,
      details: true,
      createdAt: true,
    },
  });

  return mapLogItem(created);
}

export async function listAulasOperationLogs(
  contaId: string,
  limit = 20,
  prismaClient: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<ListAgendaOperationLogsResultDTO> {
  const items = await prismaClient.aulasOperationLog.findMany({
    where: { contaId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      level: true,
      action: true,
      entityType: true,
      entityId: true,
      message: true,
      details: true,
      createdAt: true,
    },
  });

  return {
    success: true,
    data: {
      items: items.map(mapLogItem),
    },
  };
}
