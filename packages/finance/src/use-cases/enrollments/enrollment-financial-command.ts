import { createHash } from 'node:crypto';
import { MatriculaBillingOutboxStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getSubscription, updateSubscription } from '../asaas-ops';
import { syncEditableSubscriptionPayments } from './subscription-pending-payments-sync';

const commandSchema = z.object({
  version: z.literal(1),
  commandId: z.string().min(1),
  actorId: z.string().min(1),
  matriculaId: z.string().min(1),
  targetSubscriptionId: z.string().min(1),
  affectedMatriculaIds: z.array(z.string().min(1)).min(1),
  localPatchMatriculaIds: z.array(z.string().min(1)).optional(),
  remotePatch: z.object({
    value: z.number().positive().optional(), cycle: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY']).optional(),
    nextDueDate: z.string().date().optional(), endDate: z.string().date().optional(),
    updatePendingPayments: z.boolean().optional(),
    interest: z.object({ value: z.number().nonnegative() }).optional(),
    fine: z.object({ value: z.number().nonnegative(), type: z.string().optional() }).optional(),
    discount: z.object({ value: z.number().nonnegative(), type: z.string().optional(), dueDateLimitDays: z.number().int().nonnegative().optional() }).optional(),
  }),
  localPatch: z.object({
    planoId: z.string().nullable().optional(), comboId: z.string().nullable().optional(),
    dataInicio: z.string().datetime().optional(), dataFimContrato: z.string().datetime().nullable().optional(), vencimentoDia: z.number().int().min(1).max(28).optional(),
    jurosMensal: z.number().nullable().optional(), jurosTipo: z.string().nullable().optional(),
    multaPercentual: z.number().nullable().optional(), multaTipo: z.string().nullable().optional(),
    descontoAntecipado: z.number().nullable().optional(), descontoTipo: z.string().nullable().optional(), prazoDesconto: z.number().int().nullable().optional(),
  }),
  allocationValues: z.array(z.object({ matriculaId: z.string(), value: z.number().nonnegative() })).optional(),
  allocationValidity: z.object({ matriculaIds: z.array(z.string()).min(1), validUntil: z.string().date() }).optional(),
  snapshot: z.object({
    value: z.number().positive().optional(), cycle: z.string().optional(), dueDay: z.number().int().nullable().optional(),
    nextDueDate: z.string().date().nullable().optional(), validUntil: z.string().date().nullable().optional(),
    interestValue: z.number().nullable().optional(), interestType: z.string().nullable().optional(),
    fineValue: z.number().nullable().optional(), fineType: z.string().nullable().optional(),
    discountValue: z.number().nullable().optional(), discountType: z.string().nullable().optional(), discountDueDateLimitDays: z.number().int().nullable().optional(),
  }).optional(),
});
export type EnrollmentFinancialCommand = z.infer<typeof commandSchema>;
export type EnrollmentFinancialCommandResult = {
  eventId: string;
  matriculaId: string;
  status: 'PROCESSED' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'REQUIRES_RECONCILIATION';
  error?: string;
};
export type EnrollmentFinancialCommandRemote = {
  get: typeof getSubscription;
  update: typeof updateSubscription;
};

export function parseEnrollmentFinancialCommand(payload: unknown) {
  return commandSchema.parse(payload);
}

function sameCommandPayload(left: unknown, right: EnrollmentFinancialCommand) {
  try {
    const parsed = commandSchema.parse(left);
    // actorId is audit attribution, not the financial command's meaning.
    const { actorId: _leftActor, ...leftCommand } = parsed;
    const { actorId: _rightActor, ...rightCommand } = right;
    return JSON.stringify(leftCommand) === JSON.stringify(rightCommand);
  } catch {
    return false;
  }
}

/** Call only inside the same short transaction that applies the pending local edit. */
export async function enqueueEnrollmentFinancialCommand(
  tx: Prisma.TransactionClient,
  input: { contaId: string; actorId: string; command: Omit<EnrollmentFinancialCommand, 'version' | 'commandId' | 'actorId'>; dedupeKey: string },
) {
  const stableDedupeKey = createHash('sha256').update(input.dedupeKey).digest('hex');
  const commandId = createHash('sha256').update(`${input.contaId}:${stableDedupeKey}`).digest('hex');
  const payload = commandSchema.parse({ ...input.command, version: 1, commandId, actorId: input.actorId });
  const existing = await tx.matriculaBillingOutbox.findFirst({ where: { contaId: input.contaId, dedupeKey: stableDedupeKey } });
  if (existing) {
    if (!sameCommandPayload(existing.payload, payload)) throw new Error('ENROLLMENT_FINANCIAL_COMMAND_DEDUPE_CONFLICT');
    return existing;
  }
  const eligible = await tx.matricula.findMany({
    where: { id: { in: payload.affectedMatriculaIds }, contaId: input.contaId, status: { notIn: ['CANCELADA', 'ENCERRADA', 'RECUSADA'] } },
    select: { id: true },
  });
  if (eligible.length !== payload.affectedMatriculaIds.length || !eligible.some(({ id }) => id === payload.matriculaId)) {
    throw new Error('MATRICULA_ALVO_DIVERGENTE');
  }
  const inserted = await tx.matriculaBillingOutbox.createMany({
    skipDuplicates: true,
    data: [{
      contaId: input.contaId, matriculaId: payload.matriculaId, aggregateType: 'MATRICULA', aggregateId: payload.matriculaId,
      eventType: 'APPLY_ENROLLMENT_FINANCIAL_COMMAND', dedupeKey: stableDedupeKey, idempotencyKey: stableDedupeKey,
      externalReference: `matricula:${payload.matriculaId}:financial-command`, correlationId: commandId,
      payload: payload as unknown as Prisma.InputJsonValue,
    }],
  });
  // ON CONFLICT DO NOTHING keeps a concurrent dedupe race inside the caller's
  // transaction usable; the subsequent read validates the winner's payload.
  const created = await tx.matriculaBillingOutbox.findFirst({ where: { contaId: input.contaId, dedupeKey: stableDedupeKey } });
  if (!created) throw new Error('ENROLLMENT_FINANCIAL_COMMAND_ENQUEUE_FAILED');
  if (!sameCommandPayload(created.payload, payload)) throw new Error('ENROLLMENT_FINANCIAL_COMMAND_DEDUPE_CONFLICT');
  if (inserted.count > 0) {
    await tx.matriculaLog.create({
      data: { matriculaId: payload.matriculaId, actorId: input.actorId, action: 'ENROLLMENT_FINANCIAL_COMMAND_QUEUED', metadata: { eventId: created.id, correlationId: commandId, affectedMatriculaIds: payload.affectedMatriculaIds } },
    });
  }
  return created;
}

export async function processEnrollmentFinancialCommand(input: {
  db: PrismaClient;
  event: { id: string; contaId: string; matriculaId: string; attempts: number; payload: unknown };
  claimToken: string;
  now: Date;
  remote?: EnrollmentFinancialCommandRemote;
  assertLeaseOwned?: () => Promise<void>;
  finishTerminalIntent?: (input: { intent: 'RECUSADA' | 'CANCELADA'; reason: string | null; actorId: string | null }) => Promise<EnrollmentFinancialCommandResult>;
}) {
  let command: EnrollmentFinancialCommand;
  try {
    command = commandSchema.parse(input.event.payload);
  } catch {
    await input.db.matriculaBillingOutbox.updateMany({
      where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken },
      data: { status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION, lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: 'PAYLOAD_COMANDO_FINANCEIRO_INVALIDO' },
    });
    return { eventId: input.event.id, matriculaId: input.event.matriculaId, status: 'REQUIRES_RECONCILIATION' as const };
  }
  const fail = async (reason: string, terminal = false) => {
    const pendingIntent = await input.db.matriculaBillingOutbox.findFirst({
      where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, terminalIntent: { not: null } },
      select: { terminalIntent: true, terminalIntentReason: true, terminalIntentActorId: true },
    });
    if (pendingIntent?.terminalIntent && input.finishTerminalIntent) {
      return input.finishTerminalIntent({ intent: pendingIntent.terminalIntent, reason: pendingIntent.terminalIntentReason, actorId: pendingIntent.terminalIntentActorId });
    }
    const next = terminal || input.event.attempts >= 8 ? MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION : MatriculaBillingOutboxStatus.FAILED;
    const delayMinutes = Math.min(720, Math.max(5, input.event.attempts * input.event.attempts * 5));
    let transitioned = false;
    await input.db.$transaction(async (tx) => {
      const changed = await tx.matriculaBillingOutbox.updateMany({
        where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, terminalIntent: null },
        data: { status: next, lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: reason.slice(0, 2000), availableAt: next === MatriculaBillingOutboxStatus.FAILED ? new Date(input.now.getTime() + delayMinutes * 60_000) : undefined },
      });
      if (!changed.count) return;
      transitioned = true;
      await tx.matriculaLog.create({ data: { matriculaId: command.matriculaId, action: next === MatriculaBillingOutboxStatus.FAILED ? 'ENROLLMENT_FINANCIAL_COMMAND_RETRY_SCHEDULED' : 'ENROLLMENT_FINANCIAL_COMMAND_REQUIRES_RECONCILIATION', metadata: { eventId: input.event.id, correlationId: command.commandId, error: reason } } });
    });
    if (!transitioned) {
      const racedIntent = await input.db.matriculaBillingOutbox.findFirst({
        where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, terminalIntent: { not: null } },
        select: { terminalIntent: true, terminalIntentReason: true, terminalIntentActorId: true },
      });
      if (racedIntent?.terminalIntent && input.finishTerminalIntent) {
        return input.finishTerminalIntent({ intent: racedIntent.terminalIntent, reason: racedIntent.terminalIntentReason, actorId: racedIntent.terminalIntentActorId });
      }
      return { eventId: input.event.id, matriculaId: command.matriculaId, status: 'REQUIRES_RECONCILIATION' as const };
    }
    return { eventId: input.event.id, matriculaId: command.matriculaId, status: next === MatriculaBillingOutboxStatus.FAILED ? 'FAILED' as const : 'REQUIRES_RECONCILIATION' as const };
  };

  try {
    const eligible = await input.db.matricula.findMany({
      where: { id: { in: command.affectedMatriculaIds }, contaId: input.event.contaId, status: { notIn: ['CANCELADA', 'ENCERRADA', 'RECUSADA'] } },
      select: { id: true },
    });
    const targetBelongsToTenant = await input.db.billingAgreement.findFirst({
      where: {
        contaId: input.event.contaId,
        asaasSubscriptionId: command.targetSubscriptionId,
        allocations: { some: { contaId: input.event.contaId, matriculaId: { in: command.affectedMatriculaIds } } },
      },
      select: { id: true },
    });
    if (eligible.length !== command.affectedMatriculaIds.length || !eligible.some(({ id }) => id === command.matriculaId) || !targetBelongsToTenant) {
      return await fail('MATRICULA_OU_ASSINATURA_DIVERGENTE', true);
    }
    const remote = input.remote ?? { get: getSubscription, update: updateSubscription };
    await input.assertLeaseOwned?.();
    let current = await remote.get(command.targetSubscriptionId, { contaId: input.event.contaId });
    const patch = command.remotePatch;
    const remoteTerms = current as typeof current & { interest?: { value?: number | null } | null; fine?: { value?: number | null; type?: string | null } | null; discount?: { value?: number | null; type?: string | null; dueDateLimitDays?: number | null } | null };
    const matches = () =>
      (patch.value === undefined || Number(current.value) === patch.value) &&
      (patch.cycle === undefined || current.cycle === patch.cycle) &&
      (patch.nextDueDate === undefined || current.nextDueDate === patch.nextDueDate) &&
      (patch.endDate === undefined || current.endDate === patch.endDate) &&
      (patch.interest === undefined || Number(remoteTerms.interest?.value ?? 0) === patch.interest.value) &&
      (patch.fine === undefined || (Number(remoteTerms.fine?.value ?? 0) === patch.fine.value && (!patch.fine.type || remoteTerms.fine?.type?.toUpperCase() === patch.fine.type.toUpperCase()))) &&
      (patch.discount === undefined || (Number(remoteTerms.discount?.value ?? 0) === patch.discount.value && (!patch.discount.type || remoteTerms.discount?.type?.toUpperCase() === patch.discount.type.toUpperCase()) && Number(remoteTerms.discount?.dueDateLimitDays ?? 0) === Number(patch.discount.dueDateLimitDays ?? 0)));
    if (!matches() || patch.interest || patch.fine || patch.discount || patch.updatePendingPayments) {
      await input.assertLeaseOwned?.();
      await remote.update(command.targetSubscriptionId, patch as Parameters<typeof updateSubscription>[1], { contaId: input.event.contaId });
      await input.assertLeaseOwned?.();
      current = await remote.get(command.targetSubscriptionId, { contaId: input.event.contaId });
    }
    if (!matches()) return await fail('ASAAS_NAO_CONFIRMOU_ATUALIZACAO_DA_ASSINATURA');
    if (patch.interest || patch.fine || patch.discount) {
      await input.assertLeaseOwned?.();
      const alignment = await syncEditableSubscriptionPayments({
        contaId: input.event.contaId,
        asaasSubscriptionId: command.targetSubscriptionId,
        ...(input.assertLeaseOwned ? { assertLeaseOwned: input.assertLeaseOwned } : {}),
        terms: {
          ...(patch.interest !== undefined ? { interest: { value: patch.interest.value } } : {}),
          ...(patch.fine !== undefined ? { fine: { value: patch.fine.value, type: patch.fine.type === 'FIXED' ? 'FIXED' as const : 'PERCENTAGE' as const } } : {}),
          ...(patch.discount !== undefined ? { discount: { value: patch.discount.value, type: patch.discount.type === 'FIXED' ? 'FIXED' as const : 'PERCENTAGE' as const, dueDateLimitDays: patch.discount.dueDateLimitDays ?? 0 } } : {}),
        },
      });
      if (alignment.failed > 0) return await fail(`PAGAMENTOS_PENDENTES_NAO_ALINHADOS:${alignment.failed}`);
    }

    await input.assertLeaseOwned?.();
    await input.db.$transaction(async (tx) => {
      const claimed = await tx.matriculaBillingOutbox.findFirst({ where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken }, select: { id: true, terminalIntent: true } });
      if (!claimed) throw new Error('CLAIM_FINANCEIRO_PERDIDO');
      if (claimed.terminalIntent) throw new Error('INTENCAO_TERMINAL_CONCORRENTE');
      const local = command.localPatch;
      const localTargetIds = command.localPatchMatriculaIds ?? [command.matriculaId];
      for (const matriculaId of localTargetIds) {
        const updated = await tx.matricula.updateMany({ where: { id: matriculaId, contaId: input.event.contaId, status: { notIn: ['CANCELADA', 'ENCERRADA', 'RECUSADA'] } }, data: { ...local, ...(local.dataInicio ? { dataInicio: new Date(local.dataInicio) } : {}), ...(local.dataFimContrato !== undefined ? { dataFimContrato: local.dataFimContrato ? new Date(local.dataFimContrato) : null } : {}) } as Prisma.MatriculaUncheckedUpdateManyInput });
        if (!updated.count) throw new Error('MATRICULA_ALVO_DIVERGENTE');
      }
      if (command.snapshot) {
        const snapshot = command.snapshot;
        await tx.billingAgreement.updateMany({ where: { contaId: input.event.contaId, asaasSubscriptionId: command.targetSubscriptionId }, data: { ...(snapshot.value !== undefined ? { desiredValue: snapshot.value, confirmedValue: snapshot.value } : {}), ...(snapshot.cycle !== undefined ? { cycle: snapshot.cycle } : {}), ...(snapshot.dueDay !== undefined ? { dueDay: snapshot.dueDay } : {}), ...(snapshot.nextDueDate !== undefined ? { nextDueDate: snapshot.nextDueDate ? new Date(`${snapshot.nextDueDate}T00:00:00.000Z`) : null } : {}), ...(snapshot.validUntil !== undefined ? { validUntil: snapshot.validUntil ? new Date(`${snapshot.validUntil}T00:00:00.000Z`) : null } : {}), ...(snapshot.interestValue !== undefined ? { interestValue: snapshot.interestValue, interestType: snapshot.interestType } : {}), ...(snapshot.fineValue !== undefined ? { fineValue: snapshot.fineValue, fineType: snapshot.fineType } : {}), ...(snapshot.discountValue !== undefined ? { discountValue: snapshot.discountValue, discountType: snapshot.discountType, discountDueDateLimitDays: snapshot.discountDueDateLimitDays } : {}), remoteStatus: current.status, remoteStatusUpdatedAt: input.now, lastReconciledAt: input.now, reconciliationError: null, version: { increment: 1 } } });
      }
      if (command.allocationValues?.length) {
        const allocations = await tx.billingAllocation.findMany({ where: { contaId: input.event.contaId, agreement: { asaasSubscriptionId: command.targetSubscriptionId }, matriculaId: { in: command.allocationValues.map((item) => item.matriculaId) }, kind: 'TUITION', recurring: true, status: { in: ['ACTIVE', 'SCHEDULED'] } } });
        if (allocations.length !== command.allocationValues.length) throw new Error('ALOCACOES_CANONICAS_INCOMPLETAS');
        const values = new Map(command.allocationValues.map((item) => [item.matriculaId, item.value]));
        const effectiveAt = new Date(input.now);
        effectiveAt.setUTCHours(0, 0, 0, 0);
        for (const allocation of allocations) {
          const value = values.get(allocation.matriculaId);
          if (value === undefined) throw new Error('ALOCACAO_CANONICA_DIVERGENTE');
          if (Number(allocation.netAmount) === value) continue;
          if (allocation.status === 'SCHEDULED' && allocation.validFrom > effectiveAt) {
            const updated = await tx.billingAllocation.updateMany({
              where: { id: allocation.id, contaId: input.event.contaId, status: 'SCHEDULED', validFrom: allocation.validFrom },
              data: { baseAmount: value, discountAmount: 0, netAmount: value },
            });
            if (updated.count !== 1) throw new Error('ALOCACAO_CANONICA_DIVERGENTE');
            continue;
          }
          await tx.billingAllocation.updateMany({ where: { id: allocation.id, contaId: input.event.contaId, status: { in: ['ACTIVE', 'SCHEDULED'] } }, data: { status: 'ENDED', validUntil: effectiveAt } });
          await tx.billingAllocation.create({ data: { contaId: input.event.contaId, agreementId: allocation.agreementId, matriculaId: allocation.matriculaId, alunoId: allocation.alunoId, sourceChargeId: allocation.sourceChargeId, kind: allocation.kind, status: 'ACTIVE', recurring: allocation.recurring, baseAmount: value, discountAmount: 0, netAmount: value, validFrom: effectiveAt, validUntil: allocation.validUntil, prorationPolicy: allocation.prorationPolicy, metadata: allocation.metadata ?? undefined } });
        }
      }
      if (command.allocationValidity) {
        const agreement = { contaId: input.event.contaId, asaasSubscriptionId: command.targetSubscriptionId };
        const allocations = await tx.billingAllocation.findMany({
          where: { contaId: input.event.contaId, agreement, matriculaId: { in: command.allocationValidity.matriculaIds }, kind: 'TUITION', recurring: true, status: { in: ['ACTIVE', 'SCHEDULED'] } },
          select: { id: true },
        });
        if (allocations.length === 0) throw new Error('ALOCACOES_CANONICAS_INCOMPLETAS');
        const result = await tx.billingAllocation.updateMany({
          where: { contaId: input.event.contaId, agreement, id: { in: allocations.map(({ id }) => id) }, kind: 'TUITION', recurring: true, status: { in: ['ACTIVE', 'SCHEDULED'] } },
          data: { validUntil: new Date(`${command.allocationValidity.validUntil}T00:00:00.000Z`) },
        });
        if (result.count !== allocations.length) throw new Error('ALOCACOES_CANONICAS_INCOMPLETAS');
      }
      await tx.matriculaLog.create({ data: { matriculaId: command.matriculaId, actorId: command.actorId, action: 'ENROLLMENT_FINANCIAL_COMMAND_COMPLETED', metadata: { eventId: input.event.id, correlationId: command.commandId, affectedMatriculaIds: command.affectedMatriculaIds } } });
      const completed = await tx.matriculaBillingOutbox.updateMany({ where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, terminalIntent: null }, data: { status: MatriculaBillingOutboxStatus.PROCESSED, processedAt: input.now, lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: null } });
      if (!completed.count) throw new Error('CLAIM_FINANCEIRO_PERDIDO_AO_CONCLUIR');
    });
    return { eventId: input.event.id, matriculaId: command.matriculaId, status: 'PROCESSED' as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const pendingIntent = await input.db.matriculaBillingOutbox.findFirst({
      where: { id: input.event.id, contaId: input.event.contaId, status: MatriculaBillingOutboxStatus.PROCESSING, claimToken: input.claimToken, terminalIntent: { not: null } },
      select: { terminalIntent: true, terminalIntentReason: true, terminalIntentActorId: true },
    });
    if (pendingIntent?.terminalIntent && input.finishTerminalIntent) {
      return input.finishTerminalIntent({ intent: pendingIntent.terminalIntent, reason: pendingIntent.terminalIntentReason, actorId: pendingIntent.terminalIntentActorId });
    }
    const terminal = /PAYER|NOT_FOUND|NOT_EDITABLE|CLAIM_FINANCEIRO_PERDIDO|DIVERGENTE/i.test(reason);
    return fail(reason, terminal);
  }
}
