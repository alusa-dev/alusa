import {
  AsaasHttpError,
  getInstallment,
  getSubscription,
  type AsaasSubscription,
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { CustomerPayerType, Prisma } from '@prisma/client';

type SourceKind =
  | 'ACADEMIC_SUBSCRIPTION'
  | 'STANDALONE_SUBSCRIPTION'
  | 'ACADEMIC_INSTALLMENT'
  | 'STANDALONE_INSTALLMENT';

type LocalCustomerRef = {
  contaId: string;
  payerType: CustomerPayerType;
  payerId: string;
};

type AsaasInstallmentSnapshot = {
  id: string;
  customer?: string;
  billingType?: string;
  paymentValue?: number;
  value?: number;
  installmentCount?: number;
  description?: string;
  deleted?: boolean;
};

export type RebuildFinanceBillingReadModelsInput = {
  contaId?: string;
  limit?: number;
  maxAccounts?: number;
};

export type RefreshFinanceBillingRemoteSnapshotsInput = RebuildFinanceBillingReadModelsInput & {
  staleOlderThanMinutes?: number;
};

export type FinanceBillingReadModelResult = {
  accounts: number;
  subscriptionsProjected: number;
  installmentsProjected: number;
  remoteSubscriptionsRefreshed: number;
  remoteInstallmentsRefreshed: number;
  missingCredentials: number;
  failed: number;
  errors: Array<{ contaId: string; sourceKind: SourceKind; sourceId: string; message: string }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function sourceId(kind: SourceKind, id: string) {
  return `${kind}:${id}`;
}

function parseAsaasDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isNotFound(error: unknown): boolean {
  return error instanceof AsaasHttpError && error.status === 404;
}

async function listContaIds(maxAccounts: number): Promise<string[]> {
  const [subscriptions, standaloneSubscriptions, installments, standaloneInstallments] =
    await Promise.all([
      prisma.subscription.findMany({
        distinct: ['contaId'],
        orderBy: { updatedAt: 'asc' },
        take: maxAccounts,
        select: { contaId: true },
      }),
      prisma.standaloneSubscription.findMany({
        distinct: ['contaId'],
        orderBy: { updatedAt: 'asc' },
        take: maxAccounts,
        select: { contaId: true },
      }),
      prisma.installmentPlan.findMany({
        distinct: ['contaId'],
        orderBy: { updatedAt: 'asc' },
        take: maxAccounts,
        select: { contaId: true },
      }),
      prisma.standaloneInstallmentPlan.findMany({
        distinct: ['contaId'],
        orderBy: { updatedAt: 'asc' },
        take: maxAccounts,
        select: { contaId: true },
      }),
    ]);

  return Array.from(
    new Set(
      [
        ...subscriptions,
        ...standaloneSubscriptions,
        ...installments,
        ...standaloneInstallments,
      ].map((row) => row.contaId),
    ),
  ).slice(0, maxAccounts);
}

function payerKey(ref: LocalCustomerRef): string {
  return `${ref.contaId}:${ref.payerType}:${ref.payerId}`;
}

async function loadPayerNameMap(refs: LocalCustomerRef[]): Promise<Map<string, string>> {
  const alunoIds = refs
    .filter((ref) => ref.payerType === 'ALUNO')
    .map((ref) => ref.payerId);
  const responsavelIds = refs
    .filter((ref) => ref.payerType === 'RESPONSAVEL')
    .map((ref) => ref.payerId);

  const [alunos, responsaveis] = await Promise.all([
    alunoIds.length
      ? prisma.aluno.findMany({
          where: { id: { in: Array.from(new Set(alunoIds)) } },
          select: { id: true, contaId: true, nome: true },
        })
      : Promise.resolve([]),
    responsavelIds.length
      ? prisma.responsavel.findMany({
          where: { id: { in: Array.from(new Set(responsavelIds)) } },
          select: { id: true, contaId: true, nome: true },
        })
      : Promise.resolve([]),
  ]);

  const map = new Map<string, string>();
  for (const aluno of alunos) {
    map.set(payerKey({ contaId: aluno.contaId, payerType: 'ALUNO', payerId: aluno.id }), aluno.nome);
  }
  for (const responsavel of responsaveis) {
    map.set(
      payerKey({
        contaId: responsavel.contaId,
        payerType: 'RESPONSAVEL',
        payerId: responsavel.id,
      }),
      responsavel.nome,
    );
  }
  return map;
}

async function projectStandaloneSubscriptions(contaId: string, limit: number) {
  const rows = await prisma.standaloneSubscription.findMany({
    where: { contaId },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      customer: {
        select: {
          id: true,
          contaId: true,
          payerType: true,
          payerId: true,
          asaasCustomerId: true,
        },
      },
    },
  });
  const names = await loadPayerNameMap(rows.map((row) => row.customer));
  const now = new Date();

  for (const row of rows) {
    await prisma.financeSubscriptionReadModel.upsert({
      where: {
        uq_fin_subscription_rm_source: {
          contaId: row.contaId,
          sourceKind: 'STANDALONE_SUBSCRIPTION',
          sourceId: row.id,
        },
      },
      update: {
        localCustomerId: row.customerId,
        asaasCustomerId: row.customer.asaasCustomerId,
        asaasSubscriptionId: row.asaasSubscriptionId,
        payerName: names.get(payerKey(row.customer)) ?? null,
        status: String(row.status),
        billingType: row.billingType,
        cycle: row.cycle,
        value: row.value,
        nextDueDate: row.nextDueDate,
        endDate: row.endDate,
        description: row.description,
        familyGroupId: row.familyGroupId,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
      create: {
        id: sourceId('STANDALONE_SUBSCRIPTION', row.id),
        contaId: row.contaId,
        sourceKind: 'STANDALONE_SUBSCRIPTION',
        sourceId: row.id,
        localCustomerId: row.customerId,
        asaasCustomerId: row.customer.asaasCustomerId,
        asaasSubscriptionId: row.asaasSubscriptionId,
        payerName: names.get(payerKey(row.customer)) ?? null,
        status: String(row.status),
        billingType: row.billingType,
        cycle: row.cycle,
        value: row.value,
        nextDueDate: row.nextDueDate,
        endDate: row.endDate,
        description: row.description,
        familyGroupId: row.familyGroupId,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
    });
  }

  return rows.length;
}

async function projectAcademicSubscriptions(contaId: string, limit: number) {
  const rows = await prisma.subscription.findMany({
    where: { contaId },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      matricula: {
        include: {
          aluno: { select: { id: true, nome: true, asaasCustomerId: true } },
          responsavelFinanceiro: { select: { id: true, nome: true, asaasCustomerId: true } },
          cobrancas: {
            where: { status: { notIn: ['CANCELADO', 'ESTORNADO'] } },
            orderBy: { vencimento: 'asc' },
            take: 1,
            select: {
              valor: true,
              vencimento: true,
              formaPagamento: true,
              descricao: true,
            },
          },
        },
      },
    },
  });
  const now = new Date();

  for (const row of rows) {
    const nextCharge = row.matricula.cobrancas[0] ?? null;
    const payer = row.matricula.responsavelFinanceiro ?? row.matricula.aluno;

    await prisma.financeSubscriptionReadModel.upsert({
      where: {
        uq_fin_subscription_rm_source: {
          contaId: row.contaId,
          sourceKind: 'ACADEMIC_SUBSCRIPTION',
          sourceId: row.id,
        },
      },
      update: {
        asaasCustomerId: payer?.asaasCustomerId ?? null,
        asaasSubscriptionId: row.asaasSubscriptionId,
        payerName: payer?.nome ?? null,
        status: String(row.status),
        billingType: nextCharge?.formaPagamento ?? null,
        value: nextCharge?.valor ?? null,
        nextDueDate: nextCharge?.vencimento ?? null,
        description: nextCharge?.descricao ?? null,
        matriculaId: row.matriculaId,
        contratoId: row.contratoId,
        alunoId: row.matricula.aluno.id,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
      create: {
        id: sourceId('ACADEMIC_SUBSCRIPTION', row.id),
        contaId: row.contaId,
        sourceKind: 'ACADEMIC_SUBSCRIPTION',
        sourceId: row.id,
        asaasCustomerId: payer?.asaasCustomerId ?? null,
        asaasSubscriptionId: row.asaasSubscriptionId,
        payerName: payer?.nome ?? null,
        status: String(row.status),
        billingType: nextCharge?.formaPagamento ?? null,
        value: nextCharge?.valor ?? null,
        nextDueDate: nextCharge?.vencimento ?? null,
        description: nextCharge?.descricao ?? null,
        matriculaId: row.matriculaId,
        contratoId: row.contratoId,
        alunoId: row.matricula.aluno.id,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
    });
  }

  return rows.length;
}

async function projectStandaloneInstallments(contaId: string, limit: number) {
  const rows = await prisma.standaloneInstallmentPlan.findMany({
    where: { contaId },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      customer: {
        select: {
          id: true,
          contaId: true,
          payerType: true,
          payerId: true,
          asaasCustomerId: true,
        },
      },
    },
  });
  const names = await loadPayerNameMap(rows.map((row) => row.customer));
  const now = new Date();

  for (const row of rows) {
    await prisma.financeInstallmentPlanReadModel.upsert({
      where: {
        uq_fin_installment_rm_source: {
          contaId: row.contaId,
          sourceKind: 'STANDALONE_INSTALLMENT',
          sourceId: row.id,
        },
      },
      update: {
        localCustomerId: row.customerId,
        asaasCustomerId: row.customer.asaasCustomerId,
        asaasInstallmentId: row.asaasInstallmentId,
        payerName: names.get(payerKey(row.customer)) ?? null,
        status: String(row.status),
        billingType: row.billingType,
        value: row.value,
        installmentCount: row.installmentCount,
        firstDueDate: row.firstDueDate,
        familyGroupId: row.familyGroupId,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
      create: {
        id: sourceId('STANDALONE_INSTALLMENT', row.id),
        contaId: row.contaId,
        sourceKind: 'STANDALONE_INSTALLMENT',
        sourceId: row.id,
        localCustomerId: row.customerId,
        asaasCustomerId: row.customer.asaasCustomerId,
        asaasInstallmentId: row.asaasInstallmentId,
        payerName: names.get(payerKey(row.customer)) ?? null,
        status: String(row.status),
        billingType: row.billingType,
        value: row.value,
        installmentCount: row.installmentCount,
        firstDueDate: row.firstDueDate,
        familyGroupId: row.familyGroupId,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
    });
  }

  return rows.length;
}

async function projectAcademicInstallments(contaId: string, limit: number) {
  const rows = await prisma.installmentPlan.findMany({
    where: { contaId },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      matricula: {
        include: {
          aluno: { select: { id: true, nome: true, asaasCustomerId: true } },
          responsavelFinanceiro: { select: { id: true, nome: true, asaasCustomerId: true } },
        },
      },
    },
  });
  const now = new Date();

  for (const row of rows) {
    const payer = row.matricula.responsavelFinanceiro ?? row.matricula.aluno;
    await prisma.financeInstallmentPlanReadModel.upsert({
      where: {
        uq_fin_installment_rm_source: {
          contaId: row.contaId,
          sourceKind: 'ACADEMIC_INSTALLMENT',
          sourceId: row.id,
        },
      },
      update: {
        asaasCustomerId: payer?.asaasCustomerId ?? null,
        asaasInstallmentId: row.asaasInstallmentId,
        payerName: payer?.nome ?? null,
        status: String(row.status),
        billingType: row.billingType,
        value: row.value,
        installmentCount: row.installmentCount,
        firstDueDate: row.firstDueDate,
        matriculaId: row.matriculaId,
        contratoId: row.contratoId,
        alunoId: row.matricula.aluno.id,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
      create: {
        id: sourceId('ACADEMIC_INSTALLMENT', row.id),
        contaId: row.contaId,
        sourceKind: 'ACADEMIC_INSTALLMENT',
        sourceId: row.id,
        asaasCustomerId: payer?.asaasCustomerId ?? null,
        asaasInstallmentId: row.asaasInstallmentId,
        payerName: payer?.nome ?? null,
        status: String(row.status),
        billingType: row.billingType,
        value: row.value,
        installmentCount: row.installmentCount,
        firstDueDate: row.firstDueDate,
        matriculaId: row.matriculaId,
        contratoId: row.contratoId,
        alunoId: row.matricula.aluno.id,
        sourceCreatedAt: row.createdAt,
        sourceUpdatedAt: row.updatedAt,
        projectedAt: now,
      },
    });
  }

  return rows.length;
}

export async function rebuildFinanceBillingReadModels(
  input: RebuildFinanceBillingReadModelsInput = {},
): Promise<FinanceBillingReadModelResult> {
  const limit = clampInt(input.limit, 100, 1, 500);
  const maxAccounts = clampInt(input.maxAccounts, 20, 1, 100);
  const contaIds = input.contaId ? [input.contaId] : await listContaIds(maxAccounts);
  const result: FinanceBillingReadModelResult = {
    accounts: contaIds.length,
    subscriptionsProjected: 0,
    installmentsProjected: 0,
    remoteSubscriptionsRefreshed: 0,
    remoteInstallmentsRefreshed: 0,
    missingCredentials: 0,
    failed: 0,
    errors: [],
  };

  for (const contaId of contaIds) {
    result.subscriptionsProjected += await projectStandaloneSubscriptions(contaId, limit);
    result.subscriptionsProjected += await projectAcademicSubscriptions(contaId, limit);
    result.installmentsProjected += await projectStandaloneInstallments(contaId, limit);
    result.installmentsProjected += await projectAcademicInstallments(contaId, limit);
  }

  return result;
}

function remoteSubscriptionUpdate(remote: AsaasSubscription, syncedAt: Date) {
  return {
    asaasCustomerId: remote.customer ?? null,
    status: remote.deleted ? 'DELETED' : remote.status,
    billingType: remote.billingType ?? null,
    cycle: remote.cycle ?? null,
    value: remote.value ?? null,
    nextDueDate: parseAsaasDate(remote.nextDueDate),
    endDate: parseAsaasDate(remote.endDate),
    description: remote.description ?? null,
    remoteDeleted: remote.deleted ?? false,
    lastRemoteSyncAt: syncedAt,
    raw: asJson(remote),
    projectedAt: syncedAt,
  };
}

function remoteInstallmentUpdate(remote: AsaasInstallmentSnapshot, syncedAt: Date) {
  return {
    asaasCustomerId: remote.customer ?? null,
    status: remote.deleted ? 'DELETED' : 'ACTIVE',
    billingType: remote.billingType ?? null,
    value: remote.paymentValue ?? remote.value ?? null,
    installmentCount: remote.installmentCount ?? null,
    description: remote.description ?? null,
    remoteDeleted: remote.deleted ?? false,
    lastRemoteSyncAt: syncedAt,
    raw: asJson(remote),
    projectedAt: syncedAt,
  };
}

export async function refreshFinanceBillingRemoteSnapshots(
  input: RefreshFinanceBillingRemoteSnapshotsInput = {},
): Promise<FinanceBillingReadModelResult> {
  const limit = clampInt(input.limit, 25, 1, 100);
  const maxAccounts = clampInt(input.maxAccounts, 10, 1, 50);
  const staleOlderThanMinutes = clampInt(input.staleOlderThanMinutes, 360, 5, 24 * 60);
  const staleBefore = new Date(Date.now() - staleOlderThanMinutes * 60_000);
  const contaIds = input.contaId ? [input.contaId] : await listContaIds(maxAccounts);
  const result: FinanceBillingReadModelResult = {
    accounts: contaIds.length,
    subscriptionsProjected: 0,
    installmentsProjected: 0,
    remoteSubscriptionsRefreshed: 0,
    remoteInstallmentsRefreshed: 0,
    missingCredentials: 0,
    failed: 0,
    errors: [],
  };

  for (const contaId of contaIds) {
    const credentials = await loadAsaasCredentials(contaId);
    if (!credentials?.apiKey) {
      result.missingCredentials += 1;
      continue;
    }

    const [subscriptions, installments] = await Promise.all([
      prisma.financeSubscriptionReadModel.findMany({
        where: {
          contaId,
          asaasSubscriptionId: { not: null },
          OR: [{ lastRemoteSyncAt: null }, { lastRemoteSyncAt: { lt: staleBefore } }],
        },
        orderBy: [{ lastRemoteSyncAt: 'asc' }, { projectedAt: 'asc' }],
        take: limit,
      }),
      prisma.financeInstallmentPlanReadModel.findMany({
        where: {
          contaId,
          asaasInstallmentId: { not: null },
          OR: [{ lastRemoteSyncAt: null }, { lastRemoteSyncAt: { lt: staleBefore } }],
        },
        orderBy: [{ lastRemoteSyncAt: 'asc' }, { projectedAt: 'asc' }],
        take: limit,
      }),
    ]);

    for (const subscription of subscriptions) {
      const syncedAt = new Date();
      try {
        const remote = await getSubscription({
          apiKey: credentials.apiKey,
          subscriptionId: subscription.asaasSubscriptionId!,
        });
        await prisma.financeSubscriptionReadModel.update({
          where: { id: subscription.id },
          data: remoteSubscriptionUpdate(remote, syncedAt),
        });
        result.remoteSubscriptionsRefreshed += 1;
      } catch (error) {
        if (isNotFound(error)) {
          await prisma.financeSubscriptionReadModel.update({
            where: { id: subscription.id },
            data: {
              remoteDeleted: true,
              status: 'DELETED',
              lastRemoteSyncAt: syncedAt,
              projectedAt: syncedAt,
            },
          });
          result.remoteSubscriptionsRefreshed += 1;
          continue;
        }

        result.failed += 1;
        result.errors.push({
          contaId,
          sourceKind: subscription.sourceKind as SourceKind,
          sourceId: subscription.sourceId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const installment of installments) {
      const syncedAt = new Date();
      try {
        const remote = await getInstallment({
          apiKey: credentials.apiKey,
          installmentId: installment.asaasInstallmentId!,
        });
        await prisma.financeInstallmentPlanReadModel.update({
          where: { id: installment.id },
          data: remoteInstallmentUpdate(remote, syncedAt),
        });
        result.remoteInstallmentsRefreshed += 1;
      } catch (error) {
        if (isNotFound(error)) {
          await prisma.financeInstallmentPlanReadModel.update({
            where: { id: installment.id },
            data: {
              remoteDeleted: true,
              status: 'DELETED',
              lastRemoteSyncAt: syncedAt,
              projectedAt: syncedAt,
            },
          });
          result.remoteInstallmentsRefreshed += 1;
          continue;
        }

        result.failed += 1;
        result.errors.push({
          contaId,
          sourceKind: installment.sourceKind as SourceKind,
          sourceId: installment.sourceId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
