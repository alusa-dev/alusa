import type { Prisma, PrismaClient } from '@prisma/client';
import { ChargeStatus, SubscriptionStatus } from '@prisma/client';
import type { AssinaturaSnapshot } from './subscription-snapshot';
import { mapLocalSubscriptionStatus } from './subscription-snapshot';

type Db = PrismaClient | Prisma.TransactionClient;

type BillingType = AssinaturaSnapshot['billingType'];

export type MatriculaFinancialContext = {
  mode: 'INDIVIDUAL' | 'FAMILY';
  sourceMatriculaId: string;
  targetMatriculaId: string;
  contaId: string;
  asaasSubscriptionId: string | null;
  localSubscriptionId: string | null;
  localSubscriptionKind: 'ACADEMIC' | 'STANDALONE' | null;
  customerId: string | null;
  payerName: string;
  localSnapshot: AssinaturaSnapshot | null;
  family: {
    id: string;
    status: string;
    responsavel: {
      id: string;
      nome: string;
      asaasCustomerId: string | null;
    };
    affectedMatriculaIds: string[];
    alunos: Array<{ matriculaId: string; alunoId: string; nome: string }>;
  } | null;
};

const EDITABLE_STANDALONE_CHARGE_STATUSES: ChargeStatus[] = [
  ChargeStatus.CREATED,
  ChargeStatus.PENDING_SYNC,
  ChargeStatus.OPEN,
  ChargeStatus.OVERDUE,
];

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function mapStandaloneStatus(status: SubscriptionStatus): AssinaturaSnapshot['status'] {
  if (status === SubscriptionStatus.INACTIVE) return 'INACTIVE';
  if (status === SubscriptionStatus.EXPIRED || status === SubscriptionStatus.DELETED) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function normalizeBillingType(value: string | null | undefined): BillingType {
  if (value === 'BOLETO' || value === 'PIX' || value === 'CREDIT_CARD' || value === 'UNDEFINED') {
    return value;
  }
  return null;
}

function buildStandaloneSnapshot(
  subscription: {
    asaasSubscriptionId: string | null;
    status: SubscriptionStatus;
    billingType: string;
    value: Prisma.Decimal | number | string;
    nextDueDate: Date;
    updatedAt: Date;
  } | null,
): AssinaturaSnapshot | null {
  if (!subscription?.asaasSubscriptionId) return null;

  return {
    asaasSubscriptionId: subscription.asaasSubscriptionId,
    status: mapStandaloneStatus(subscription.status),
    billingType: normalizeBillingType(subscription.billingType),
    value: toNumber(subscription.value),
    nextDueDate: toDateOnly(subscription.nextDueDate),
    deleted: subscription.status === SubscriptionStatus.DELETED,
    syncError: null,
    syncedAt: subscription.updatedAt.toISOString(),
  };
}

export function isFinancialContextEditable(context: MatriculaFinancialContext) {
  return (
    Boolean(context.asaasSubscriptionId) &&
    context.localSnapshot?.deleted !== true &&
    context.localSnapshot?.status !== 'EXPIRED'
  );
}

export async function resolveMatriculaFinancialContext(input: {
  db: Db;
  matriculaId: string;
  contaId: string;
}): Promise<MatriculaFinancialContext | null> {
  const matricula = await input.db.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: {
      id: true,
      contaId: true,
      asaasSubscriptionId: true,
      matriculaFamiliarId: true,
      aluno: {
        select: {
          id: true,
          nome: true,
          asaasCustomerId: true,
        },
      },
      responsavelFinanceiro: {
        select: {
          id: true,
          nome: true,
          asaasCustomerId: true,
        },
      },
      subscriptions: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
      matriculaFamiliar: {
        select: {
          id: true,
          status: true,
          responsavel: {
            select: {
              id: true,
              nome: true,
              asaasCustomerId: true,
            },
          },
          standaloneSubscriptionId: true,
          items: {
            orderBy: { orderIndex: 'asc' },
            select: {
              matriculaId: true,
              matricula: {
                select: {
                  id: true,
                  aluno: { select: { id: true, nome: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!matricula) return null;

  const family = matricula.matriculaFamiliar ?? null;
  if (family) {
    const standaloneSubscription = await input.db.standaloneSubscription.findFirst({
      where: {
        contaId: input.contaId,
        OR: [
          ...(family.standaloneSubscriptionId ? [{ id: family.standaloneSubscriptionId }] : []),
          { familyGroupId: family.id },
        ],
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        status: true,
        billingType: true,
        value: true,
        nextDueDate: true,
        endDate: true,
        updatedAt: true,
        customer: { select: { asaasCustomerId: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const alunos = family.items.map((item) => ({
      matriculaId: item.matricula.id,
      alunoId: item.matricula.aluno.id,
      nome: item.matricula.aluno.nome,
    }));

    return {
      mode: 'FAMILY',
      sourceMatriculaId: matricula.id,
      targetMatriculaId: alunos[0]?.matriculaId ?? matricula.id,
      contaId: input.contaId,
      asaasSubscriptionId: standaloneSubscription?.asaasSubscriptionId ?? null,
      localSubscriptionId: standaloneSubscription?.id ?? null,
      localSubscriptionKind: standaloneSubscription ? 'STANDALONE' : null,
      customerId:
        standaloneSubscription?.customer?.asaasCustomerId ??
        family.responsavel.asaasCustomerId ??
        null,
      payerName: family.responsavel.nome,
      localSnapshot: buildStandaloneSnapshot(standaloneSubscription ?? null),
      family: {
        id: family.id,
        status: family.status,
        responsavel: {
          id: family.responsavel.id,
          nome: family.responsavel.nome,
          asaasCustomerId: family.responsavel.asaasCustomerId,
        },
        affectedMatriculaIds: alunos.map((item) => item.matriculaId),
        alunos,
      },
    };
  }

  const localSubscription = matricula.subscriptions?.[0] ?? null;
  const customerId =
    matricula.responsavelFinanceiro?.asaasCustomerId ?? matricula.aluno?.asaasCustomerId ?? null;

  return {
    mode: 'INDIVIDUAL',
    sourceMatriculaId: matricula.id,
    targetMatriculaId: matricula.id,
    contaId: input.contaId,
    asaasSubscriptionId: matricula.asaasSubscriptionId ?? null,
    localSubscriptionId: localSubscription?.id ?? null,
    localSubscriptionKind: localSubscription ? 'ACADEMIC' : null,
    customerId,
    payerName: matricula.responsavelFinanceiro?.nome ?? matricula.aluno?.nome ?? 'Aluno',
    localSnapshot: matricula.asaasSubscriptionId
      ? {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          status: mapLocalSubscriptionStatus(localSubscription?.status),
          billingType: null,
          value: null,
          nextDueDate: null,
          deleted: localSubscription?.status === SubscriptionStatus.DELETED,
          syncError: null,
          syncedAt: (localSubscription?.updatedAt ?? new Date()).toISOString(),
        }
      : null,
    family: null,
  };
}

export async function updateFamilyFinancialLocalState(input: {
  db: Db;
  context: MatriculaFinancialContext;
  value?: number | null;
  cycle?: string | null;
  billingType?: string | null;
  nextDueDate?: string | null;
  endDate?: string | null;
  interest?: { value: number } | null;
  fine?: { value: number; type?: 'FIXED' | 'PERCENTAGE' } | null;
  discount?: { value: number; type?: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays?: number } | null;
}) {
  if (input.context.mode !== 'FAMILY' || !input.context.family) {
    return { matriculasUpdated: 0, subscriptionsUpdated: 0, chargesUpdated: 0, readModelsUpdated: 0 };
  }

  const matriculaData: Prisma.MatriculaUpdateManyMutationInput = {};
  const familyData: Prisma.MatriculaFamiliarUpdateInput = {};
  const subscriptionData: Prisma.StandaloneSubscriptionUpdateManyMutationInput = {};
  const chargeData: Prisma.ChargeUpdateManyMutationInput = {};
  const readModelData: Prisma.ChargeReadModelUpdateManyMutationInput = {};

  if (typeof input.value === 'number') {
    subscriptionData.value = input.value;
    chargeData.value = input.value;
    readModelData.value = input.value;
  }

  if (input.cycle) {
    subscriptionData.cycle = input.cycle;
  }

  if (input.billingType) {
    subscriptionData.billingType = input.billingType;
    chargeData.billingType = input.billingType;
    readModelData.billingType = input.billingType;
    familyData.formaPagamento = input.billingType;
    if (input.billingType === 'CREDIT_CARD') {
      matriculaData.formaPagamento = 'CARTAO_CREDITO';
    } else if (input.billingType === 'BOLETO' || input.billingType === 'PIX') {
      matriculaData.formaPagamento = input.billingType;
    } else if (input.billingType === 'UNDEFINED') {
      matriculaData.formaPagamento = 'INDEFINIDO';
    }
  }

  if (input.nextDueDate) {
    const nextDueDate = new Date(`${input.nextDueDate}T12:00:00.000Z`);
    subscriptionData.nextDueDate = nextDueDate;
    chargeData.dueDate = nextDueDate;
    readModelData.dueDate = nextDueDate;
    familyData.diaVencimento = nextDueDate.getUTCDate();
    matriculaData.vencimentoDia = nextDueDate.getUTCDate();
  }

  if (input.endDate) {
    const endDate = new Date(`${input.endDate}T12:00:00.000Z`);
    subscriptionData.endDate = endDate;
    familyData.dataFimContrato = endDate;
    matriculaData.dataFimContrato = endDate;
  }

  if (input.interest) {
    matriculaData.jurosMensal = input.interest.value;
    matriculaData.jurosTipo = 'PERCENTAGE';
  }

  if (input.fine) {
    matriculaData.multaPercentual = input.fine.value;
    matriculaData.multaTipo = input.fine.type ?? 'PERCENTAGE';
  }

  if (input.discount) {
    matriculaData.descontoAntecipado = input.discount.value > 0 ? input.discount.value : null;
    matriculaData.descontoTipo = input.discount.value > 0 ? input.discount.type ?? 'PERCENTAGE' : null;
    matriculaData.prazoDesconto =
      input.discount.value > 0 ? input.discount.dueDateLimitDays ?? 0 : null;
  }

  const affectedMatriculaIds = input.context.family.affectedMatriculaIds;
  const subscriptionWhere = {
    contaId: input.context.contaId,
    id: input.context.localSubscriptionId ?? '',
  };
  const chargeWhere = {
    contaId: input.context.contaId,
    standaloneSubscriptionId: input.context.localSubscriptionId,
    familyGroupId: input.context.family.id,
    status: { in: EDITABLE_STANDALONE_CHARGE_STATUSES },
  };

  const [matriculasResult, subscriptionResult, chargesResult, readModelsResult] =
    await Promise.all([
      Object.keys(matriculaData).length > 0
        ? input.db.matricula.updateMany({
            where: { contaId: input.context.contaId, id: { in: affectedMatriculaIds } },
            data: matriculaData,
          })
        : Promise.resolve({ count: 0 }),
      input.context.localSubscriptionId && Object.keys(subscriptionData).length > 0
        ? input.db.standaloneSubscription.updateMany({
            where: subscriptionWhere,
            data: subscriptionData,
          })
        : Promise.resolve({ count: 0 }),
      input.context.localSubscriptionId && Object.keys(chargeData).length > 0
        ? input.db.charge.updateMany({
            where: chargeWhere,
            data: chargeData,
          })
        : Promise.resolve({ count: 0 }),
      input.context.localSubscriptionId && Object.keys(readModelData).length > 0
        ? input.db.chargeReadModel.updateMany({
            where: {
              contaId: input.context.contaId,
              sourceKind: 'CHARGE',
              sourceId: {
                in: (
                  await input.db.charge.findMany({
                    where: chargeWhere,
                    select: { id: true },
                  })
                ).map((charge) => charge.id),
              },
            },
            data: readModelData,
          })
        : Promise.resolve({ count: 0 }),
    ]);

  if (Object.keys(familyData).length > 0) {
    await input.db.matriculaFamiliar.update({
      where: { id: input.context.family.id },
      data: familyData,
    });
  }

  return {
    matriculasUpdated: matriculasResult.count,
    subscriptionsUpdated: subscriptionResult.count,
    chargesUpdated: chargesResult.count,
    readModelsUpdated: readModelsResult.count,
  };
}
