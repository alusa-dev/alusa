import type { PrismaClient } from '@prisma/client';

type OutboxClient = Pick<PrismaClient, 'matriculaBillingOutbox'>;

export type EnrollmentTerminalIntent = 'RECUSADA' | 'CANCELADA';

type Input = {
  db: OutboxClient;
  contaId: string;
  matriculaId: string;
  intent: EnrollmentTerminalIntent;
  reason: string;
  actorId: string;
};

/** Coordinate terminal state changes with tenant-scoped billing outbox claims. */
export async function requestEnrollmentTerminalIntent(input: Input) {
  const activeStatuses = ['PENDING', 'FAILED', 'PROCESSING', 'REQUIRES_RECONCILIATION'] as const;
  const outbox = await input.db.matriculaBillingOutbox.findFirst({
    where: { contaId: input.contaId, matriculaId: input.matriculaId, status: { in: [...activeStatuses] } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true, terminalIntent: true, attempts: true },
  });
  if (!outbox) return { kind: 'NO_PENDING' as const };
  if (outbox.terminalIntent && outbox.terminalIntent !== input.intent) {
    return { kind: 'CONFLICT' as const, eventId: outbox.id };
  }
  if (outbox.status === 'REQUIRES_RECONCILIATION') {
    if (!outbox.terminalIntent) {
      const saved = await input.db.matriculaBillingOutbox.updateMany({
      where: { id: outbox.id, contaId: input.contaId, matriculaId: input.matriculaId, status: 'REQUIRES_RECONCILIATION', terminalIntent: null, claimToken: null },
        data: intentData(input),
      });
      if (saved.count === 0) return recheck(input, outbox.id);
    }
    return { kind: 'RECONCILIATION_REQUIRED' as const, eventId: outbox.id };
  }
  if (outbox.status === 'PROCESSING') {
    if (outbox.terminalIntent === input.intent) return { kind: 'DEFERRED' as const, eventId: outbox.id };
    const saved = await input.db.matriculaBillingOutbox.updateMany({
      where: { id: outbox.id, contaId: input.contaId, matriculaId: input.matriculaId, status: 'PROCESSING', terminalIntent: null, claimToken: { not: null } },
      data: intentData(input),
    });
    return saved.count > 0 ? { kind: 'DEFERRED' as const, eventId: outbox.id } : recheck(input, outbox.id);
  }

  // FAILED (or a previously retried PENDING row) may already have created
  // remote resources. Freeze it for reconciliation instead of assuming that
  // a failed attempt had no external effects.
  if (outbox.attempts > 0) {
    const held = await input.db.matriculaBillingOutbox.updateMany({
      where: {
        id: outbox.id,
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        status: outbox.status,
        terminalIntent: null,
        claimToken: null,
      },
      data: {
        ...intentData(input),
        status: 'REQUIRES_RECONCILIATION',
        lockedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastError: `INTENCAO_${input.intent}_AGUARDA_RECONCILIACAO_DE_TENTATIVA_ANTERIOR`,
      },
    });
    return held.count > 0
      ? { kind: 'RECONCILIATION_REQUIRED' as const, eventId: outbox.id }
      : recheck(input, outbox.id);
  }

  // PENDING/FAILED race directly with the worker's claim CAS. If this CAS wins,
  // cancellation is durable before the caller changes the academic status.
  const cancelled = await input.db.matriculaBillingOutbox.updateMany({
    where: {
      id: outbox.id,
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      status: outbox.status,
      terminalIntent: null,
      claimToken: null,
    },
    data: {
      ...intentData(input),
      status: 'CANCELLED',
      lockedAt: null,
      leaseExpiresAt: null,
      claimToken: null,
      lastError: `INTENCAO_${input.intent}_CANCELA_EVENTO_NAO_REIVINDICADO`,
    },
  });
  return cancelled.count > 0 ? { kind: 'CANCELLED' as const, eventId: outbox.id } : recheck(input, outbox.id);
}

function intentData(input: Input) {
  return {
    terminalIntent: input.intent,
    terminalIntentReason: input.reason.slice(0, 2000),
    terminalIntentActorId: input.actorId,
    terminalIntentAt: new Date(),
  };
}

async function recheck(input: Input, eventId: string) {
  const current = await input.db.matriculaBillingOutbox.findFirst({
    where: { id: eventId, contaId: input.contaId, matriculaId: input.matriculaId },
    select: { id: true, status: true, terminalIntent: true, attempts: true },
  });
  if (!current) return { kind: 'NO_PENDING' as const };
  if (current.terminalIntent && current.terminalIntent !== input.intent) {
    return { kind: 'CONFLICT' as const, eventId: current.id };
  }
  if (current.status === 'PROCESSING') {
    if (current.terminalIntent === input.intent) return { kind: 'DEFERRED' as const, eventId: current.id };
    const saved = await input.db.matriculaBillingOutbox.updateMany({
      where: { id: current.id, contaId: input.contaId, matriculaId: input.matriculaId, status: 'PROCESSING', terminalIntent: null, claimToken: { not: null } },
      data: intentData(input),
    });
    return saved.count > 0 ? { kind: 'DEFERRED' as const, eventId: current.id } : { kind: 'RACED' as const, eventId: current.id };
  }
  if (current.status === 'REQUIRES_RECONCILIATION') {
    if (!current.terminalIntent) {
      const saved = await input.db.matriculaBillingOutbox.updateMany({
        where: { id: current.id, contaId: input.contaId, matriculaId: input.matriculaId, status: 'REQUIRES_RECONCILIATION', terminalIntent: null, claimToken: null },
        data: intentData(input),
      });
      if (saved.count === 0) return { kind: 'RACED' as const, eventId: current.id };
    }
    return { kind: 'RECONCILIATION_REQUIRED' as const, eventId: current.id };
  }
  if (current.status === 'CANCELLED' && current.terminalIntent === input.intent) {
    return { kind: 'CANCELLED' as const, eventId: current.id };
  }
  return { kind: 'RACED' as const, eventId: current.id };
}
