import {
  PlatformBillingError,
  assertPlatformAccess,
  assertStudentCapacityDomain,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
  type PlatformBillingCapability,
} from '@alusa/platform-billing';
import type { PlatformPlanCode } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  countActivePlatformBillingStudents,
  resolvePlatformBillingEnvironment,
} from './platform-billing-server';

type PlatformBillingTx = TenantTransactionClient;

export async function assertPlatformAccessForConta(input: {
  contaId: string;
  capability: PlatformBillingCapability;
}): Promise<void> {
  await runWithTenant(input.contaId, async (tx) => {
    await assertPlatformAccessForCapability({
      tx,
      contaId: input.contaId,
      capability: input.capability,
    });
  });
}

/**
 * Shared route-handler adapter. Returning a response from this helper keeps
 * every API route consistent without exposing billing internals to clients.
 */
export async function platformBillingAccessResponseForConta(input: {
  contaId: string;
  capability: PlatformBillingCapability;
}) {
  try {
    await assertPlatformAccessForConta(input);
    return null;
  } catch (error) {
    return platformBillingAccessResponse(error);
  }
}

export function isPlatformBillingAccessError(error: unknown): error is PlatformBillingError {
  return error instanceof PlatformBillingError && error.code === 'PLATFORM_BILLING_ACCESS_RESTRICTED';
}

export function platformBillingAccessResponse(error: unknown) {
  if (!isPlatformBillingAccessError(error)) return null;

  return {
    status: 402,
    body: {
      error: 'PLATFORM_BILLING_ACCESS_RESTRICTED',
      message: 'A conta está restrita. Regularize o plano e faturamento para realizar esta operação.',
      details: error.details,
    },
  } as const;
}

export async function assertPlatformAccessForCapability(input: {
  tx: PlatformBillingTx;
  contaId: string;
  capability: PlatformBillingCapability;
}): Promise<void> {
  const environment = resolvePlatformBillingEnvironment();
  const account = await input.tx.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: {
        contaId: input.contaId,
        environment,
      },
    },
  });

  if (!account) {
    assertPlatformAccess({
      contaId: input.contaId,
      account: null,
      capability: input.capability,
    });
    return;
  }

  const now = new Date();
  const effectiveAccessStatus = derivePlatformAccessStatus({
    account,
    now,
  });
  const restrictionReason = derivePlatformRestrictionReason({ account, now });
  if (effectiveAccessStatus !== account.accessStatus || restrictionReason !== account.restrictionReason) {
    await input.tx.platformBillingAccount.update({
      where: { id: account.id },
      data: {
        accessStatus: effectiveAccessStatus,
        restrictedAt: effectiveAccessStatus === 'RESTRICTED' ? new Date() : account.restrictedAt,
        restrictionReason,
        accessStateVersion: { increment: 1 },
      },
    });
  }

  assertPlatformAccess({
    contaId: input.contaId,
    account: { ...account, accessStatus: effectiveAccessStatus, restrictionReason },
    capability: input.capability,
  });
}

export async function assertStudentCapacity(input: {
  tx: PlatformBillingTx;
  contaId: string;
  additionalActiveStudents: number;
  operation: string;
}): Promise<void> {
  const additionalActiveStudents = Math.max(0, Math.floor(input.additionalActiveStudents));
  if (additionalActiveStudents <= 0) return;

  await assertPlatformAccessForCapability({
    tx: input.tx,
    contaId: input.contaId,
    capability: 'STUDENT_WRITE',
  });

  const environment = resolvePlatformBillingEnvironment();
  await acquirePlatformBillingContaLock(input.tx, input.contaId);

  const account = await input.tx.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: {
        contaId: input.contaId,
        environment,
      },
    },
    select: {
      id: true,
      planCode: true,
      accessStatus: true,
    },
  });

  if (!account?.planCode) return;

  const activeStudents = await countActivePlatformBillingStudents({
    tx: input.tx,
    contaId: input.contaId,
  });

  try {
    assertStudentCapacityDomain({
      contaId: input.contaId,
      planCode: account.planCode as PlatformPlanCode,
      activeStudents,
      additionalActiveStudents,
    });
  } catch (error) {
    if (error instanceof PlatformBillingError) {
      await input.tx.platformBillingAuditLog.create({
        data: {
          contaId: input.contaId,
          billingAccountId: account.id,
          action: 'PLATFORM_BILLING_STUDENT_CAPACITY_BLOCKED',
          entityType: 'Conta',
          entityId: input.contaId,
          correlationId: input.operation,
          metadata: {
            operation: input.operation,
            ...error.details,
          },
        },
      });
    }
    throw error;
  }
}

export async function countAdditionalActiveStudentsForEnrollment(input: {
  tx: PlatformBillingTx;
  contaId: string;
  alunoId: string;
}): Promise<number> {
  const aluno = await input.tx.aluno.findFirst({
    where: {
      id: input.alunoId,
      contaId: input.contaId,
      status: 'ATIVO',
    },
    select: { id: true },
  });
  if (!aluno) return 0;

  const existingActiveEnrollment = await input.tx.matricula.findFirst({
    where: {
      contaId: input.contaId,
      alunoId: input.alunoId,
      status: 'ATIVA',
    },
    select: { id: true },
  });

  return existingActiveEnrollment ? 0 : 1;
}

export function isPlatformBillingCapacityError(error: unknown): error is PlatformBillingError {
  return error instanceof PlatformBillingError &&
    (error.code === 'PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED' ||
      error.code === 'PLATFORM_BILLING_ACCESS_RESTRICTED');
}

async function acquirePlatformBillingContaLock(tx: PlatformBillingTx, contaId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-billing:capacity:${contaId}`}, 0))`;
}
