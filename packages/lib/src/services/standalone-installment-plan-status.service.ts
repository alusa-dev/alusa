import {
  deriveInstallmentPlanLifecycleStatus,
  type InstallmentChargeLifecycleStatus,
} from '@alusa/domain/rules/installment-plan-status';
import type { Prisma, PrismaClient, InstallmentStatus } from '@prisma/client';

import { prisma } from '../prisma';

type StandalonePlanStatusDb = PrismaClient | Prisma.TransactionClient;

const PAID_PROVIDER_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'PAID',
]);

const CANCELED_PROVIDER_STATUSES = new Set(['CANCELED', 'CANCELLED', 'DELETED']);

function resolveChargeLifecycleStatus(charge: {
  status: string;
  asaasStatus: string | null;
}): InstallmentChargeLifecycleStatus {
  const localStatus = charge.status.toUpperCase();
  const providerStatus = charge.asaasStatus?.toUpperCase() ?? null;

  if (localStatus === 'CANCELED' || CANCELED_PROVIDER_STATUSES.has(providerStatus ?? '')) {
    return 'CANCELED';
  }
  if (localStatus === 'PAID' || PAID_PROVIDER_STATUSES.has(providerStatus ?? '')) {
    return 'PAID';
  }
  return 'OPEN';
}

export type StandaloneInstallmentPlanStatusConvergence = {
  planId: string;
  previousStatus: InstallmentStatus;
  nextStatus: InstallmentStatus;
  changed: boolean;
  chargeStatuses: InstallmentChargeLifecycleStatus[];
};

/**
 * Converge somente o estado local do plano a partir das parcelas já
 * persistidas. Não chama o Asaas e nunca atravessa o tenant informado.
 */
export async function convergeStandaloneInstallmentPlanStatus(input: {
  contaId: string;
  planId: string;
  db?: StandalonePlanStatusDb;
  now?: Date;
  apply?: boolean;
}): Promise<StandaloneInstallmentPlanStatusConvergence | null> {
  const db = input.db ?? prisma;
  const plan = await db.standaloneInstallmentPlan.findFirst({
    where: { id: input.planId, contaId: input.contaId },
    select: {
      id: true,
      status: true,
      charges: { select: { status: true, asaasStatus: true } },
    },
  });

  if (!plan) return null;

  const chargeStatuses = plan.charges.map(resolveChargeLifecycleStatus);
  const nextStatus = deriveInstallmentPlanLifecycleStatus({
    currentStatus: plan.status,
    chargeStatuses,
  }) as InstallmentStatus;

  if (nextStatus === plan.status) {
    return {
      planId: plan.id,
      previousStatus: plan.status,
      nextStatus,
      changed: false,
      chargeStatuses,
    };
  }

  if (input.apply !== false) {
    await db.standaloneInstallmentPlan.update({
      where: { id: plan.id },
      data: { status: nextStatus, statusUpdatedAt: input.now ?? new Date() },
    });
  }

  return {
    planId: plan.id,
    previousStatus: plan.status,
    nextStatus,
    changed: true,
    chargeStatuses,
  };
}

export async function listStandaloneInstallmentPlanIdsForParticipant(input: {
  contaId: string;
  standaloneChargeId?: string | null;
  asaasInstallmentId?: string | null;
  db?: StandalonePlanStatusDb;
}): Promise<string[]> {
  const db = input.db ?? prisma;
  const ids = new Set<string>();

  if (input.standaloneChargeId) {
    const [plan, charge] = await Promise.all([
      db.standaloneInstallmentPlan.findFirst({
        where: { id: input.standaloneChargeId, contaId: input.contaId },
        select: { id: true },
      }),
      db.charge.findFirst({
        where: { id: input.standaloneChargeId, contaId: input.contaId },
        select: { standaloneInstallmentPlanId: true },
      }),
    ]);
    if (plan) ids.add(plan.id);
    if (charge?.standaloneInstallmentPlanId) ids.add(charge.standaloneInstallmentPlanId);
  }

  if (input.asaasInstallmentId) {
    const plan = await db.standaloneInstallmentPlan.findFirst({
      where: { asaasInstallmentId: input.asaasInstallmentId, contaId: input.contaId },
      select: { id: true },
    });
    if (plan) ids.add(plan.id);
  }

  return [...ids];
}

export async function reconcileStandaloneInstallmentPlanStatuses(input: {
  contaId?: string;
  dryRun?: boolean;
  limit?: number;
  db?: PrismaClient;
}): Promise<{
  dryRun: boolean;
  inspected: number;
  changed: number;
  plans: StandaloneInstallmentPlanStatusConvergence[];
}> {
  const db = input.db ?? prisma;
  const dryRun = input.dryRun ?? true;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 1_000);
  const plans = await db.standaloneInstallmentPlan.findMany({
    where: {
      ...(input.contaId ? { contaId: input.contaId } : {}),
      status: 'ACTIVE',
      charges: { some: { status: 'CANCELED' } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, contaId: true },
  });

  const results: StandaloneInstallmentPlanStatusConvergence[] = [];
  for (const plan of plans) {
    if (dryRun) {
      const result = await convergeStandaloneInstallmentPlanStatus({
        contaId: plan.contaId,
        planId: plan.id,
        db,
        apply: false,
      });
      if (result) results.push(result);
      continue;
    }

    const result = await convergeStandaloneInstallmentPlanStatus({
      contaId: plan.contaId,
      planId: plan.id,
      db,
    });
    if (!result) continue;
    results.push(result);

    if (result.changed) {
      await db.auditLog.create({
        data: {
          contaId: plan.contaId,
          actorType: 'SYSTEM',
          action: 'finance.standalone_installment_plan.status_converged',
          entityType: 'StandaloneInstallmentPlan',
          entityId: plan.id,
          metadata: {
            previousStatus: result.previousStatus,
            nextStatus: result.nextStatus,
            chargeStatuses: result.chargeStatuses,
            reason: 'all_persisted_charges_canceled_or_settled',
          },
        },
      });
    }
  }

  return {
    dryRun,
    inspected: plans.length,
    changed: results.filter((result) => result.changed).length,
    plans: results,
  };
}
