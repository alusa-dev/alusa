import {
  PlatformBillingError,
  assertPlatformAccess,
  assertStudentCapacityDomain,
  derivePlatformAccessStatus,
  type PlatformBillingCapability,
} from '@alusa/platform-billing';
import type { PlatformPlanCode } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import {
  countActivePlatformBillingStudents,
  resolvePlatformBillingEnvironment,
} from './platform-billing-server';

type PlatformBillingTx = TenantTransactionClient;

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

  if (!account) return;

  const accessStatus = derivePlatformAccessStatus({ account });
  if (accessStatus !== account.accessStatus) {
    await input.tx.platformBillingAccount.update({
      where: { id: account.id },
      data: {
        accessStatus,
        restrictedAt: accessStatus === 'RESTRICTED' ? new Date() : account.restrictedAt,
      },
    });
  }

  assertPlatformAccess({
    contaId: input.contaId,
    account: { ...account, accessStatus },
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
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-billing:capacity:${contaId}`}, 0))`;
}
