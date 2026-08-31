import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@alusa/lib/prisma';

type DbClient = PrismaClient | Prisma.TransactionClient;

type SafeCandidate = {
  entryId: string;
  contaId: string;
  amount: number;
  groupId: string;
  planId: string;
  chargeIds: string[];
};

const contaId = readOption('--conta-id');
const apply = process.argv.includes('--apply');

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function money(value: Prisma.Decimal | number | null): number {
  return Number(value ?? 0);
}

async function findSafeCandidates(db: DbClient): Promise<SafeCandidate[]> {
  const entries = await db.eventFinancialEntry.findMany({
    where: {
      ...(contaId ? { contaId } : {}),
      type: 'REVENUE',
      status: { in: ['EXPECTED', 'PENDING'] },
      paymentProvider: 'ASAAS',
      asaasPaymentId: null,
      actualAmount: null,
      payments: { none: {} },
      description: { contains: 'cobrança agrupada do evento' },
    },
    select: {
      id: true,
      contaId: true,
      expectedAmount: true,
    },
  });
  if (entries.length === 0) return [];

  const participants = await db.eventParticipant.findMany({
    where: {
      contaId: { in: Array.from(new Set(entries.map((entry) => entry.contaId))) },
      revenueEntryId: { in: entries.map((entry) => entry.id) },
    },
    select: {
      revenueEntryId: true,
      billingGroupId: true,
      balanceAmount: true,
      cancelledAt: true,
      billingGroup: {
        select: {
          id: true,
          status: true,
          balanceAmount: true,
          standaloneChargeId: true,
        },
      },
    },
  });

  const planIds = Array.from(new Set(
    participants
      .map((participant) => participant.billingGroup?.standaloneChargeId)
      .filter((value): value is string => Boolean(value)),
  ));
  const plans = planIds.length
    ? await db.standaloneInstallmentPlan.findMany({
        where: {
          contaId: contaId ?? undefined,
          id: { in: planIds },
          status: { in: ['ACTIVE', 'COMPLETED'] },
        },
        select: {
          id: true,
          value: true,
          charges: {
            select: {
              id: true,
              status: true,
              asaasPaymentId: true,
              processingStatus: true,
              reconciliationStatus: true,
            },
          },
        },
      })
    : [];

  const participantByEntry = new Map(participants.map((participant) => [participant.revenueEntryId, participant]));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));

  return entries.flatMap((entry) => {
    const participant = participantByEntry.get(entry.id);
    const group = participant?.billingGroup;
    const planId = group?.standaloneChargeId;
    const plan = planId ? planById.get(planId) : undefined;
    const hasOnlyCanonicalCharges = Boolean(
      plan &&
      plan.charges.length > 0 &&
      plan.charges.every((charge) =>
        Boolean(charge.asaasPaymentId) &&
        charge.status !== 'CANCELED' &&
        charge.processingStatus === 'PROCESSED' &&
        charge.reconciliationStatus === 'IN_SYNC',
      ),
    );

    if (
      !participant?.revenueEntryId ||
      participant.cancelledAt ||
      !group ||
      group.status !== 'OPEN' ||
      !plan ||
      !hasOnlyCanonicalCharges ||
      money(participant.balanceAmount) !== money(entry.expectedAmount) ||
      money(group.balanceAmount) !== money(plan.value)
    ) {
      return [];
    }

    return [{
      entryId: entry.id,
      contaId: entry.contaId,
      amount: money(entry.expectedAmount),
      groupId: group.id,
      planId: plan.id,
      chargeIds: plan.charges.map((charge) => charge.id),
    }];
  });
}

if (process.env.NODE_ENV !== 'production') {
  throw new Error('Esta rotina só pode ser executada com NODE_ENV=production.');
}

const candidates = await findSafeCandidates(prisma);
console.info(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  contaId: contaId ?? 'all',
  candidateCount: candidates.length,
  candidateAmount: candidates.reduce((total, candidate) => total + candidate.amount, 0),
  candidates,
}, null, 2));

if (apply && candidates.length > 0) {
  const result = await prisma.$transaction(async (tx) => {
    const confirmed = await findSafeCandidates(tx);
    const ids = confirmed.map((candidate) => candidate.entryId);
    if (ids.length === 0) return { deleted: 0, audited: 0, clearedParticipantLinks: 0 };

    for (const candidate of confirmed) {
      await tx.auditLog.create({
        data: {
          contaId: candidate.contaId,
          actorType: 'SYSTEM',
          action: 'maintenance.remove_materialized_grouped_event_entry',
          entityType: 'EventFinancialEntry',
          entityId: candidate.entryId,
          metadata: {
            reason: 'duplicate participant allocation covered by a materialized Asaas installment plan',
            groupId: candidate.groupId,
            planId: candidate.planId,
            chargeIds: candidate.chargeIds,
            amount: candidate.amount,
          },
        },
      });
    }

    let clearedParticipantLinks = 0;
    for (const candidate of confirmed) {
      const updated = await tx.eventParticipant.updateMany({
        where: {
          contaId: candidate.contaId,
          revenueEntryId: candidate.entryId,
        },
        data: { revenueEntryId: null },
      });
      clearedParticipantLinks += updated.count;
    }

    const deleted = await tx.eventFinancialEntry.deleteMany({
      where: {
        id: { in: ids },
        ...(contaId ? { contaId } : {}),
        type: 'REVENUE',
        status: { in: ['EXPECTED', 'PENDING'] },
        paymentProvider: 'ASAAS',
        asaasPaymentId: null,
        actualAmount: null,
        payments: { none: {} },
      },
    });
    return { deleted: deleted.count, audited: confirmed.length, clearedParticipantLinks };
  });
  console.info(JSON.stringify({ ...result, mode: 'apply' }, null, 2));
}

await prisma.$disconnect();
