import {
  PlatformBillingError,
  assertPlatformAccess,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
  type PlatformBillingCapability,
} from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { runWithTenant } from '@/lib/prisma-tenant';
import { isAcademicDateInFuture } from '@alusa/shared/date-only';
import {
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
    return platformBillingAccessResponse(error) ?? platformBillingAccessUnavailableResponse();
  }
}

function platformBillingAccessUnavailableResponse() {
  return {
    status: 503,
    body: {
      error: 'PLATFORM_BILLING_ACCESS_UNAVAILABLE',
      message: 'Não foi possível verificar o acesso da conta. Tente novamente em instantes.',
    },
  } as const;
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
  await assertPlatformAccessForCapability({
    tx: input.tx,
    contaId: input.contaId,
    capability: 'STUDENT_WRITE',
  });

  // Student thresholds select a price band only; they never restrict enrollment.
  void input.additionalActiveStudents;
  void input.operation;
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

  const account = await input.tx.conta.findUnique({
    where: { id: input.contaId },
    select: { timezone: true },
  });
  const existingActiveEnrollments = await input.tx.matricula.findMany({
    where: {
      contaId: input.contaId,
      alunoId: input.alunoId,
      status: 'ATIVA',
    },
    select: { id: true, dataInicio: true },
  });

  const hasCurrentEnrollment = existingActiveEnrollments.some((enrollment) =>
    !isAcademicDateInFuture(enrollment.dataInicio, new Date(), account?.timezone ?? undefined),
  );
  return hasCurrentEnrollment ? 0 : 1;
}

export function isPlatformBillingCapacityError(error: unknown): error is PlatformBillingError {
  return error instanceof PlatformBillingError && error.code === 'PLATFORM_BILLING_ACCESS_RESTRICTED';
}
