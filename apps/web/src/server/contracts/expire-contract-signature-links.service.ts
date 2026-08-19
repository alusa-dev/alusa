import type { PrismaClient } from '@prisma/client';
import { createContractEvidence } from '@alusa/lib';

export async function expireContractSignatureLinks(input: {
  contaId: string;
  contractId?: string;
  limit?: number;
  now?: Date;
}, deps: { prisma: PrismaClient }) {
  const now = input.now ?? new Date();
  const candidates = await deps.prisma.contrato.findMany({
    where: {
      contaId: input.contaId,
      ...(input.contractId ? { id: input.contractId } : {}),
      status: 'PENDENTE',
      tokenExpiraEm: { not: null, lt: now },
    },
    orderBy: { tokenExpiraEm: 'asc' },
    take: input.limit ?? 500,
    select: { id: true, matriculaId: true, tokenExpiraEm: true },
  });

  if (candidates.length === 0) return { atualizados: 0, contratoIds: [] as string[] };

  return deps.prisma.$transaction(async (tx) => {
    const expired = [] as typeof candidates;
    for (const candidate of candidates) {
      const updated = await tx.contrato.updateMany({
        where: {
          contaId: input.contaId,
          id: candidate.id,
          status: 'PENDENTE',
          tokenExpiraEm: { not: null, lt: now },
        },
        data: { status: 'EXPIRADO' },
      });
      if (updated.count === 1) expired.push(candidate);
    }

    if (expired.length === 0) return { atualizados: 0, contratoIds: [] as string[] };

    const expiredIds = expired.map((candidate) => candidate.id);
    const matriculaIds = expired.map((candidate) => candidate.matriculaId);

    await tx.matricula.updateMany({
      where: {
        contaId: input.contaId,
        id: { in: matriculaIds },
        contratoAtualId: { in: expiredIds },
      },
      data: { statusContrato: 'EXPIRADO', contratoAtualId: null },
    });

    for (const candidate of expired) {
      await createContractEvidence(tx as never, {
        contaId: input.contaId,
        contratoId: candidate.id,
        type: 'LINK_EXPIRED',
        actorType: 'SYSTEM',
        payload: {
          expiredAt: candidate.tokenExpiraEm?.toISOString() ?? now.toISOString(),
          source: 'CONTRACT_LINK_EXPIRATION_JOB',
        },
      });
    }

    return { atualizados: expiredIds.length, contratoIds: expiredIds };
  });
}
