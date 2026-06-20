import { Prisma, type PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type PendingStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';

export type CreateRenewalPendingInput = {
  contaId: string;
  processoId?: string | null;
  campanhaId?: string | null;
  itemId?: string | null;
  type:
    | 'ACTIVATION_BLOCKED'
    | 'FINANCIAL_PROVISION_FAILED'
    | 'CONTRACT_SIGNATURE_PENDING'
    | 'CAPACITY_UNAVAILABLE'
    | 'INTEGRITY_VIOLATION'
    | 'WEBHOOK_UNCORRELATED'
    | 'MANUAL_REVIEW';
  severity?: 'INFO' | 'WARNING' | 'BLOCKER' | 'CRITICAL';
  code: string;
  title: string;
  message: string;
  rule?: string | null;
  impact?: string | null;
  metadata?: Record<string, unknown> | null;
  createdById?: string | null;
};

function toJson(value?: Record<string, unknown> | null) {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function pendingDTO(pending: {
  id: string;
  processoId: string | null;
  campanhaId: string | null;
  itemId: string | null;
  type: string;
  severity: string;
  status: string;
  code: string;
  title: string;
  message: string;
  rule: string | null;
  impact: string | null;
  resolution: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}) {
  return {
    id: pending.id,
    processoId: pending.processoId,
    campanhaId: pending.campanhaId,
    itemId: pending.itemId,
    type: pending.type,
    severity: pending.severity,
    status: pending.status,
    code: pending.code,
    title: pending.title,
    message: pending.message,
    rule: pending.rule,
    impact: pending.impact,
    resolution: pending.resolution,
    metadata: pending.metadata,
    createdAt: pending.createdAt.toISOString(),
    updatedAt: pending.updatedAt.toISOString(),
    resolvedAt: pending.resolvedAt?.toISOString() ?? null,
  };
}

export async function createRenewalPending(
  input: CreateRenewalPendingInput,
  deps: { prisma: PrismaLike },
) {
  const where: Prisma.RematriculaPendenciaWhereInput = {
    contaId: input.contaId,
    code: input.code,
    status: { in: ['OPEN', 'IN_PROGRESS'] },
    ...(input.processoId !== undefined ? { processoId: input.processoId } : {}),
    ...(input.campanhaId !== undefined ? { campanhaId: input.campanhaId } : {}),
    ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
  };

  const existing = await deps.prisma.rematriculaPendencia.findFirst({ where });
  if (existing) {
    const updated = await deps.prisma.rematriculaPendencia.update({
      where: { id: existing.id },
      data: {
        type: input.type,
        severity: input.severity ?? existing.severity,
        title: input.title,
        message: input.message,
        rule: input.rule ?? existing.rule,
        impact: input.impact ?? existing.impact,
        metadata: toJson(input.metadata),
      },
    });
    return pendingDTO(updated);
  }

  const created = await deps.prisma.rematriculaPendencia.create({
    data: {
      contaId: input.contaId,
      processoId: input.processoId ?? null,
      campanhaId: input.campanhaId ?? null,
      itemId: input.itemId ?? null,
      type: input.type,
      severity: input.severity ?? 'BLOCKER',
      code: input.code,
      title: input.title,
      message: input.message,
      rule: input.rule ?? null,
      impact: input.impact ?? null,
      metadata: toJson(input.metadata),
      createdById: input.createdById ?? null,
    },
  });

  if (created.processoId || created.campanhaId) {
    await deps.prisma.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: created.processoId,
        campanhaId: created.campanhaId,
        actorId: input.createdById ?? null,
        action: 'RENEWAL_PENDING_CREATED',
        entityType: 'RematriculaPendencia',
        entityId: created.id,
        afterState: pendingDTO(created) as Prisma.InputJsonValue,
      },
    });
  }

  return pendingDTO(created);
}

export async function resolveRenewalPending(
  input: {
    contaId: string;
    pendingId: string;
    actorId: string;
    resolution: string;
    status?: Extract<PendingStatus, 'RESOLVED' | 'DISMISSED'>;
  },
  deps: { prisma: PrismaClient },
) {
  if (!input.resolution.trim()) {
    throw new Error('RESOLUCAO_OBRIGATORIA');
  }

  return deps.prisma.$transaction(async (tx) => {
    const pending = await tx.rematriculaPendencia.findFirst({
      where: { id: input.pendingId, contaId: input.contaId },
    });
    if (!pending) throw new Error('PENDENCIA_NAO_ENCONTRADA');
    if (pending.status === 'RESOLVED' || pending.status === 'DISMISSED') {
      return pendingDTO(pending);
    }

    const updated = await tx.rematriculaPendencia.update({
      where: { id: pending.id },
      data: {
        status: input.status ?? 'RESOLVED',
        resolution: input.resolution.trim(),
        resolvedById: input.actorId,
        resolvedAt: new Date(),
      },
    });

    if (pending.processoId) {
      const openBlockers = await tx.rematriculaPendencia.count({
        where: {
          contaId: input.contaId,
          processoId: pending.processoId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          severity: { in: ['BLOCKER', 'CRITICAL'] },
        },
      });
      const processo = await tx.rematriculaProcesso.findFirst({
        where: { id: pending.processoId, contaId: input.contaId },
        select: { id: true, status: true },
      });

      if (processo?.status === 'REQUIRES_ATTENTION' && openBlockers === 0) {
        await tx.rematriculaProcesso.update({
          where: { id: processo.id },
          data: { status: 'CONFIRMED', updatedById: input.actorId },
        });
      }
    }

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: pending.processoId,
        campanhaId: pending.campanhaId,
        actorId: input.actorId,
        action: input.status === 'DISMISSED' ? 'RENEWAL_PENDING_DISMISSED' : 'RENEWAL_PENDING_RESOLVED',
        entityType: 'RematriculaPendencia',
        entityId: pending.id,
        reason: input.resolution.trim(),
        beforeState: pendingDTO(pending) as Prisma.InputJsonValue,
        afterState: pendingDTO(updated) as Prisma.InputJsonValue,
      },
    });

    return pendingDTO(updated);
  });
}

export async function grantRenewalException(
  input: {
    contaId: string;
    actorId: string;
    processoId?: string | null;
    campanhaId?: string | null;
    itemId?: string | null;
    permission: string;
    rule: string;
    impact: string;
    justification: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  },
  deps: { prisma: PrismaClient },
) {
  if (!input.justification.trim()) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA');
  }

  return deps.prisma.$transaction(async (tx) => {
    const excecao = await tx.rematriculaExcecao.create({
      data: {
        contaId: input.contaId,
        processoId: input.processoId ?? null,
        campanhaId: input.campanhaId ?? null,
        itemId: input.itemId ?? null,
        permission: input.permission,
        rule: input.rule,
        impact: input.impact,
        justification: input.justification.trim(),
        actorId: input.actorId,
        expiresAt: input.expiresAt ?? null,
        metadata: toJson(input.metadata),
      },
    });

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: input.processoId ?? null,
        campanhaId: input.campanhaId ?? null,
        actorId: input.actorId,
        action: 'RENEWAL_EXCEPTION_GRANTED',
        entityType: 'RematriculaExcecao',
        entityId: excecao.id,
        reason: input.justification.trim(),
        afterState: excecao as Prisma.InputJsonValue,
      },
    });

    return {
      id: excecao.id,
      status: excecao.status,
      permission: excecao.permission,
      rule: excecao.rule,
      createdAt: excecao.createdAt.toISOString(),
    };
  });
}

export async function createRenewalCommunication(
  input: {
    contaId: string;
    actorId: string;
    processoId?: string | null;
    campanhaId?: string | null;
    participanteId?: string | null;
    channel: 'EMAIL' | 'WHATSAPP' | 'SMS' | 'PORTAL';
    audience: string;
    subject?: string | null;
    message: string;
    scheduledAt?: Date | null;
    payload?: Record<string, unknown> | null;
  },
  deps: { prisma: PrismaClient },
) {
  if (!input.message.trim()) {
    throw new Error('MENSAGEM_OBRIGATORIA');
  }

  const communication = await deps.prisma.rematriculaComunicacao.create({
    data: {
      contaId: input.contaId,
      processoId: input.processoId ?? null,
      campanhaId: input.campanhaId ?? null,
      participanteId: input.participanteId ?? null,
      channel: input.channel,
      audience: input.audience,
      status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      subject: input.subject ?? null,
      message: input.message.trim(),
      scheduledAt: input.scheduledAt ?? null,
      payload: toJson(input.payload),
      createdById: input.actorId,
    },
  });

  await deps.prisma.rematriculaAuditLog.create({
    data: {
      contaId: input.contaId,
      processoId: input.processoId ?? null,
      campanhaId: input.campanhaId ?? null,
      actorId: input.actorId,
      action: 'RENEWAL_COMMUNICATION_CREATED',
      entityType: 'RematriculaComunicacao',
      entityId: communication.id,
      afterState: communication as Prisma.InputJsonValue,
    },
  });

  return {
    id: communication.id,
    status: communication.status,
    channel: communication.channel,
    scheduledAt: communication.scheduledAt?.toISOString() ?? null,
  };
}

