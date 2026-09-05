import { createHash } from 'crypto';
import { PeriodicidadePlano, Prisma, type PrismaClient } from '@prisma/client';

import { calcularPrecoMatricula } from './matricula-pricing';
import {
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
} from './recurring-billing';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type InitialEnrollmentBillingStrategy =
  | 'CREATE_SEPARATE'
  | 'INCLUDE_EXISTING'
  | 'UNIFY_NEXT_CYCLE';

export type CanonicalEnrollmentBillingStrategy =
  | { kind: 'SEPARATE' }
  | { kind: 'JOIN_EXISTING_CURRENT_CYCLE'; financialGroupId: string; effectiveAt: string }
  | { kind: 'SCHEDULE_NEXT_CYCLE_UNIFICATION'; financialGroupId: string; effectiveAt: string };

type FinancialGroupTarget =
  | { kind: 'FAMILY_GROUP'; id: string }
  | { kind: 'SUBSCRIPTION'; id: string };

type CurrentCycleChargeState =
  | 'NOT_GENERATED'
  | 'PENDING'
  | 'PAID'
  | 'OVERDUE'
  | 'PROCESSING'
  | 'CANCELLED';

type InitialEnrollmentBillingAction =
  | 'CREATE_SEPARATE'
  | 'CREATE_ONE_TIME_CHARGE'
  | 'UPDATE_SUBSCRIPTION'
  | 'UPDATE_PENDING'
  | 'CREATE_COMPLEMENT'
  | 'MANUAL_REVIEW'
  | 'SCHEDULE_NEXT_CYCLE';

type LocalChargeSnapshot = {
  id: string;
  status: string;
  asaasStatus: string | null;
  dueDate: Date;
  competenceStart: Date | null;
  competenceEnd: Date | null;
};

export type InitialEnrollmentBillingPreviewItem = {
  alunoId: string;
  matriculaId?: string | null;
  turmaId?: string | null;
  comboId?: string | null;
  planoId?: string | null;
  taxaMatricula?: number | null;
  valorMensalidadeOverride?: number | null;
};

export type InitialEnrollmentBillingPreviewInput = {
  contaId: string;
  enrollmentMode?: 'INDIVIDUAL' | 'FAMILY';
  familyPricingMode?: 'AGGREGATE_PLAN' | 'ITEMIZED_COMBOS';
  aggregateMonthlyAmount?: number;
  aggregateEnrollmentFeeAmount?: number;
  strategy?: InitialEnrollmentBillingStrategy;
  billingStrategy?: CanonicalEnrollmentBillingStrategy;
  responsavelFinanceiroId?: string | null;
  existingFamilyGroupId?: string | null;
  dataInicio: Date;
  dataFimContrato: Date;
  formaPagamento: string;
  vencimentoDia: number;
  descontoIds?: string[];
  items: InitialEnrollmentBillingPreviewItem[];
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isoDateTime(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sortedById<T extends { id: string }>(records: T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function chargeState(charge: LocalChargeSnapshot | null): CurrentCycleChargeState {
  if (!charge) return 'NOT_GENERATED';
  const status = (charge.asaasStatus ?? charge.status).trim().toUpperCase();
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAGO', 'PAID'].includes(status)) {
    return 'PAID';
  }
  if (['OVERDUE', 'ATRASADO', 'VENCIDO', 'DUNNING_REQUESTED'].includes(status)) return 'OVERDUE';
  if (['PROCESSING', 'PROCESSANDO', 'AWAITING_RISK_ANALYSIS'].includes(status)) return 'PROCESSING';
  if (['CANCELLED', 'CANCELED', 'CANCELADO', 'DELETED', 'REFUNDED', 'ESTORNADO'].includes(status)) {
    return 'CANCELLED';
  }
  return 'PENDING';
}

function currentChargeForDate(charges: LocalChargeSnapshot[], effectiveAt: Date) {
  const effectiveDate = dateOnly(effectiveAt);
  const ordered = [...charges].sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());
  return (
    ordered.find(
      (charge) =>
        charge.competenceStart &&
        charge.competenceEnd &&
        dateOnly(charge.competenceStart) <= effectiveDate &&
        dateOnly(charge.competenceEnd) >= effectiveDate,
    ) ??
    ordered.find((charge) => dateOnly(charge.dueDate) >= effectiveDate) ??
    ordered.at(-1) ??
    null
  );
}

function subscriptionIsUnavailable(input: {
  localStatus: string | null | undefined;
  agreementStatus?: string | null;
  remoteStatus?: string | null;
}) {
  const unavailable = new Set([
    'EXPIRED',
    'INACTIVE',
    'DELETED',
    'FAILED',
    'CANCELLED',
    'CANCELED',
    'CANCELLATION_PENDING',
    'REQUIRES_RECONCILIATION',
  ]);
  return [input.localStatus, input.agreementStatus, input.remoteStatus]
    .filter((status): status is string => Boolean(status))
    .some((status) => unavailable.has(status.trim().toUpperCase()));
}

function toLegacyStrategy(
  billingStrategy?: CanonicalEnrollmentBillingStrategy,
  fallback: InitialEnrollmentBillingStrategy = 'CREATE_SEPARATE',
): InitialEnrollmentBillingStrategy {
  if (!billingStrategy) return fallback;
  if (billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE') return 'INCLUDE_EXISTING';
  if (billingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION') return 'UNIFY_NEXT_CYCLE';
  return 'CREATE_SEPARATE';
}

function toCanonicalStrategy(input: {
  strategy?: InitialEnrollmentBillingStrategy;
  billingStrategy?: CanonicalEnrollmentBillingStrategy;
  existingFamilyGroupId?: string | null;
  dataInicio: Date;
}): CanonicalEnrollmentBillingStrategy {
  if (input.billingStrategy) return input.billingStrategy;

  if (input.strategy === 'INCLUDE_EXISTING' && input.existingFamilyGroupId) {
    return {
      kind: 'JOIN_EXISTING_CURRENT_CYCLE',
      financialGroupId: input.existingFamilyGroupId,
      effectiveAt: input.dataInicio.toISOString(),
    };
  }

  if (input.strategy === 'UNIFY_NEXT_CYCLE' && input.existingFamilyGroupId) {
    return {
      kind: 'SCHEDULE_NEXT_CYCLE_UNIFICATION',
      financialGroupId: input.existingFamilyGroupId,
      effectiveAt: input.dataInicio.toISOString(),
    };
  }

  return { kind: 'SEPARATE' };
}

function parseFinancialGroupTarget(id: string | null | undefined): FinancialGroupTarget | null {
  if (!id) return null;
  if (id.startsWith('subscription:')) {
    const subscriptionId = id.slice('subscription:'.length).trim();
    return subscriptionId ? { kind: 'SUBSCRIPTION', id: subscriptionId } : null;
  }
  if (id.startsWith('family:')) {
    const familyGroupId = id.slice('family:'.length).trim();
    return familyGroupId ? { kind: 'FAMILY_GROUP', id: familyGroupId } : null;
  }
  return { kind: 'FAMILY_GROUP', id };
}

export async function previewInitialEnrollmentBilling(
  input: InitialEnrollmentBillingPreviewInput,
  deps: {
    prisma: PrismaLike;
    getRemoteSubscription?: (_input: { contaId: string; subscriptionId: string }) => Promise<{
      status?: string | null;
      deleted?: boolean;
    }>;
  },
) {
  const blockers: Array<{ code: string; message: string; itemId?: string | null }> = [];
  const warnings: string[] = [];
  const billingStrategy = toCanonicalStrategy(input);
  const strategy = toLegacyStrategy(billingStrategy, input.strategy ?? 'CREATE_SEPARATE');
  const existingFamilyGroupId =
    billingStrategy.kind === 'SEPARATE'
      ? input.existingFamilyGroupId ?? null
      : billingStrategy.financialGroupId;
  const financialGroupTarget = parseFinancialGroupTarget(existingFamilyGroupId);

  if (input.items.length === 0) {
    blockers.push({ code: 'NO_ITEMS', message: 'Informe ao menos uma matrícula para o preview.' });
  }

  const alunoIds = Array.from(new Set(input.items.map((item) => item.alunoId)));
  const planIds = Array.from(
    new Set(input.items.map((item) => item.planoId).filter((id): id is string => Boolean(id))),
  );
  const comboIds = Array.from(
    new Set(input.items.map((item) => item.comboId).filter((id): id is string => Boolean(id))),
  );
  const descontoIds = Array.from(new Set(input.descontoIds ?? []));

  const [alunos, planos, combos, descontos, responsavel, existingFamilyGroup, existingSubscription] = await Promise.all([
    alunoIds.length
      ? deps.prisma.aluno.findMany({
          where: { contaId: input.contaId, id: { in: alunoIds } },
          // The preview must be invalidated by changes that affect eligibility,
          // such as activation or the payer age boundary. Integration metadata
          // (asaasCustomerId and updatedAt) is deliberately excluded: customer
          // linking is part of the commit flow itself.
          select: { id: true, nome: true, status: true, dataNasc: true },
        })
      : [],
    planIds.length
      ? deps.prisma.plano.findMany({
          where: { contaId: input.contaId, id: { in: planIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, status: true },
        })
      : [],
    comboIds.length
      ? deps.prisma.combo.findMany({
          where: { contaId: input.contaId, id: { in: comboIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, status: true, vagasLimite: true },
        })
      : [],
    descontoIds.length
      ? deps.prisma.desconto.findMany({
          where: { contaId: input.contaId, id: { in: descontoIds }, status: 'ATIVO' },
          select: { id: true, tipo: true, valor: true, escopo: true, status: true },
        })
      : [],
    input.responsavelFinanceiroId
      ? deps.prisma.responsavel.findFirst({
          where: { contaId: input.contaId, id: input.responsavelFinanceiroId },
          // Name, contact details and Asaas linkage are not billing terms. CPF
          // remains part of the source because it determines the payer identity.
          select: { id: true, cpf: true },
        })
      : null,
    financialGroupTarget?.kind === 'FAMILY_GROUP'
      ? deps.prisma.matriculaFamiliar.findFirst({
          where: { contaId: input.contaId, id: financialGroupTarget.id },
          select: {
            id: true,
            responsavelId: true,
            formaPagamento: true,
            diaVencimento: true,
            dataInicio: true,
            dataFimContrato: true,
            valorMensalidadeTotal: true,
            ciclo: true,
            billingProvisionStatus: true,
            standaloneSubscriptionId: true,
            billingVersion: true,
            status: true,
          },
        })
      : null,
    financialGroupTarget?.kind === 'SUBSCRIPTION'
      ? deps.prisma.subscription.findFirst({
          where: { contaId: input.contaId, id: financialGroupTarget.id },
          select: {
            id: true,
            asaasSubscriptionId: true,
            status: true,
            billingAgreement: {
              select: {
                status: true,
                remoteStatus: true,
                nextDueDate: true,
                validUntil: true,
              },
            },
            matricula: {
              select: {
                id: true,
                alunoId: true,
                responsavelFinanceiroId: true,
                formaPagamento: true,
                vencimentoDia: true,
                dataInicio: true,
                dataFimContrato: true,
                aluno: { select: { id: true, nome: true } },
                plano: { select: { valor: true, periodicidade: true } },
                combo: { select: { valor: true, periodicidade: true } },
                cobrancas: {
                  select: {
                    id: true,
                    status: true,
                    asaasStatus: true,
                    vencimento: true,
                    competenciaInicio: true,
                    competenciaFim: true,
                  },
                  orderBy: { vencimento: 'asc' },
                },
              },
            },
          },
        })
      : null,
  ]);
  const existingFamilySubscription = existingFamilyGroup?.standaloneSubscriptionId
    ? await deps.prisma.standaloneSubscription.findFirst({
        where: {
          id: existingFamilyGroup.standaloneSubscriptionId,
          contaId: input.contaId,
          familyGroupId: existingFamilyGroup.id,
        },
        select: {
          id: true,
          status: true,
          asaasSubscriptionId: true,
          value: true,
          nextDueDate: true,
          endDate: true,
          remoteStatus: true,
          version: true,
          billingAgreement: {
            select: {
              status: true,
              remoteStatus: true,
              nextDueDate: true,
              validUntil: true,
            },
          },
          charges: {
            select: {
              id: true,
              status: true,
              asaasStatus: true,
              dueDate: true,
              cobranca: {
                select: {
                  vencimento: true,
                  competenciaInicio: true,
                  competenciaFim: true,
                },
              },
            },
            orderBy: { dueDate: 'asc' },
          },
        },
      })
    : null;
  const remoteSubscriptionId =
    existingSubscription?.asaasSubscriptionId ?? existingFamilySubscription?.asaasSubscriptionId ?? null;
  if (deps.getRemoteSubscription && remoteSubscriptionId) {
    try {
      const official = await deps.getRemoteSubscription({
        contaId: input.contaId,
        subscriptionId: remoteSubscriptionId,
      });
      if (
        official.deleted ||
        ['EXPIRED', 'DELETED', 'INACTIVE', 'CANCELLED'].includes(String(official.status ?? '').toUpperCase())
      ) {
        blockers.push({
          code: 'ASSINATURA_REMOTA_INDISPONIVEL',
          message: 'A assinatura está expirada, inativa ou removida no Asaas. Regularize-a antes de unificar.',
        });
      }
    } catch {
      blockers.push({
        code: 'ASSINATURA_REMOTA_NAO_VERIFICADA',
        message: 'Não foi possível confirmar a assinatura no Asaas. Tente novamente antes de concluir a matrícula.',
      });
    }
  }

  const alunosById = new Map(alunos.map((aluno) => [aluno.id, aluno]));
  const planosById = new Map(planos.map((plano) => [plano.id, plano]));
  const combosById = new Map(combos.map((combo) => [combo.id, combo]));

  if (alunos.length !== alunoIds.length) {
    blockers.push({
      code: 'ALUNO_FORA_DA_CONTA',
      message: 'Um ou mais alunos não pertencem à conta atual.',
    });
  }
  if (input.responsavelFinanceiroId && !responsavel) {
    blockers.push({
      code: 'PAGADOR_FORA_DA_CONTA',
      message: 'O pagador informado não pertence à conta atual.',
    });
  }
  if (strategy === 'INCLUDE_EXISTING' && !existingFamilyGroup && !existingSubscription) {
    blockers.push({
      code: 'AGRUPAMENTO_NAO_ENCONTRADO',
      message: 'O agrupamento financeiro existente não foi encontrado nesta conta.',
    });
  }
  if (
    strategy === 'INCLUDE_EXISTING' &&
    existingFamilyGroup &&
    input.enrollmentMode !== 'FAMILY'
  ) {
    blockers.push({
      code: 'AGRUPAMENTO_FAMILIAR_NAO_SUPORTADO',
      message: 'A matrícula individual só pode ser incluída em uma assinatura existente.',
    });
  }
  if (strategy !== 'CREATE_SEPARATE' && !existingFamilyGroupId) {
    blockers.push({
      code: 'AGRUPAMENTO_OBRIGATORIO',
      message: 'Informe o agrupamento financeiro para unificar cobrancas.',
    });
  }
  if (existingFamilyGroup && input.responsavelFinanceiroId && existingFamilyGroup.responsavelId !== input.responsavelFinanceiroId) {
    blockers.push({
      code: 'PAGADOR_INCOMPATIVEL',
      message: 'O agrupamento existente pertence a outro pagador.',
    });
  }
  if (existingSubscription) {
    const requestedPayerId = input.responsavelFinanceiroId ?? input.items[0]?.alunoId ?? null;
    const subscriptionPayerId =
      existingSubscription.matricula.responsavelFinanceiroId ??
      existingSubscription.matricula.alunoId;
    if (requestedPayerId && subscriptionPayerId !== requestedPayerId) {
      blockers.push({
        code: 'PAGADOR_INCOMPATIVEL',
        message: 'A assinatura existente pertence a outro pagador.',
      });
    }
    if (!existingSubscription.asaasSubscriptionId) {
      blockers.push({
        code: 'ASSINATURA_NAO_PROVISIONADA',
        message: 'A assinatura existente ainda nao esta pronta para receber outra matricula.',
      });
    }
    if (
      subscriptionIsUnavailable({
        localStatus: existingSubscription.status,
        agreementStatus: existingSubscription.billingAgreement?.status,
        remoteStatus:
          existingSubscription.billingAgreement?.remoteStatus ?? existingSubscription.status,
      })
    ) {
      blockers.push({
        code: 'ASSINATURA_EXISTENTE_INDISPONIVEL',
        message:
          'A assinatura existente está expirada, inativa ou exige reconciliação. Crie uma cobrança separada ou regularize a assinatura antes de unificar.',
      });
    }
  }
  if (existingFamilyGroup?.formaPagamento && existingFamilyGroup.formaPagamento !== input.formaPagamento) {
    blockers.push({
      code: 'FORMA_PAGAMENTO_INCOMPATIVEL',
      message: 'A forma de pagamento não é compatível com o agrupamento existente.',
    });
  }
  if (existingFamilyGroup?.diaVencimento && existingFamilyGroup.diaVencimento !== input.vencimentoDia) {
    blockers.push({
      code: 'VENCIMENTO_INCOMPATIVEL',
      message: 'O dia de vencimento não é compatível com o agrupamento existente.',
    });
  }
  if (
    (strategy === 'INCLUDE_EXISTING' || strategy === 'UNIFY_NEXT_CYCLE') &&
    input.enrollmentMode === 'FAMILY' &&
    existingFamilyGroup &&
    (!existingFamilyGroup.standaloneSubscriptionId ||
      existingFamilyGroup.billingProvisionStatus !== 'PROVISIONADO' ||
      !existingFamilySubscription?.asaasSubscriptionId ||
      existingFamilySubscription.status !== 'ACTIVE')
  ) {
    blockers.push({
      code: 'ASSINATURA_FAMILIAR_NAO_PROVISIONADA',
      message: 'O agrupamento familiar ainda não está pronto para receber novos alunos.',
    });
  }
  if (
    existingFamilySubscription &&
    subscriptionIsUnavailable({
      localStatus: existingFamilySubscription.status,
      agreementStatus: existingFamilySubscription.billingAgreement?.status,
      remoteStatus:
        existingFamilySubscription.billingAgreement?.remoteStatus ??
        existingFamilySubscription.remoteStatus,
    })
  ) {
    blockers.push({
      code: 'ASSINATURA_EXISTENTE_INDISPONIVEL',
      message:
        'A assinatura familiar está expirada, inativa ou exige reconciliação. Regularize-a antes de incluir novas matrículas.',
    });
  }
  if (
    existingFamilyGroup &&
    existingFamilySubscription &&
    money(existingFamilySubscription.value) !== money(existingFamilyGroup.valorMensalidadeTotal)
  ) {
    blockers.push({
      code: 'VALOR_ASSINATURA_FAMILIAR_DIVERGENTE',
      message: 'O valor financeiro local do agrupamento precisa ser reconciliado antes da inclusão.',
    });
  }
  if (
    existingFamilyGroup?.dataFimContrato &&
    dateOnly(existingFamilyGroup.dataFimContrato) !== dateOnly(input.dataFimContrato)
  ) {
    warnings.push(
      `A nova matrícula terá vigência própria até ${dateOnly(input.dataFimContrato)}; a assinatura compartilhada seguirá a maior data final entre as matrículas ativas.`,
    );
  }
  if (
    existingSubscription?.matricula.formaPagamento &&
    existingSubscription.matricula.formaPagamento !== input.formaPagamento
  ) {
    blockers.push({
      code: 'FORMA_PAGAMENTO_INCOMPATIVEL',
      message: 'A forma de pagamento nao e compativel com a assinatura existente.',
    });
  }
  if (
    existingSubscription?.matricula.vencimentoDia &&
    existingSubscription.matricula.vencimentoDia !== input.vencimentoDia
  ) {
    blockers.push({
      code: 'VENCIMENTO_INCOMPATIVEL',
      message: 'O dia de vencimento nao e compativel com a assinatura existente.',
    });
  }
  if (
    existingSubscription &&
    dateOnly(existingSubscription.matricula.dataFimContrato) !== dateOnly(input.dataFimContrato)
  ) {
    warnings.push(
      `A nova matrícula terá vigência própria até ${dateOnly(input.dataFimContrato)}; a assinatura compartilhada não usará a data final de outra matrícula como limite individual.`,
    );
  }

  const allocations = input.items.map((item) => {
    const aluno = alunosById.get(item.alunoId);
    const combo = item.comboId ? combosById.get(item.comboId) : null;
    const plano = item.planoId ? planosById.get(item.planoId) : null;
    if (item.comboId && !combo) {
      blockers.push({
        code: 'COMBO_INVALIDO',
        message: 'Combo não encontrado ou inativo nesta conta.',
        itemId: item.alunoId,
      });
    }
    if (!item.comboId && item.planoId && !plano) {
      blockers.push({
        code: 'PLANO_INVALIDO',
        message: 'Plano não encontrado ou inativo nesta conta.',
        itemId: item.alunoId,
      });
    }

    const baseAmount =
      item.valorMensalidadeOverride && item.valorMensalidadeOverride > 0
        ? item.valorMensalidadeOverride
        : money(combo?.valor ?? plano?.valor);
    const price = calcularPrecoMatricula({
      planoValor: baseAmount,
      taxaMatricula: money(item.taxaMatricula),
      descontos: descontos.map((desconto) => ({
        tipo: desconto.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
        valor: money(desconto.valor),
        cumulativo: false,
      })),
    });

    return {
      alunoId: item.alunoId,
      alunoNome: aluno?.nome ?? '',
      matriculaId: item.matriculaId ?? null,
      contratoId: null,
      planoId: item.planoId ?? null,
      comboId: item.comboId ?? null,
      turmaId: item.turmaId ?? null,
      competenceStart: input.dataInicio.toISOString(),
      competenceEnd: input.dataFimContrato.toISOString(),
      baseAmount,
      amount: price.planoLiquido,
      discountAmount: money(baseAmount - price.planoLiquido),
      enrollmentFeeAmount: money(item.taxaMatricula),
    };
  });

  const periodicities = new Set(
    input.items
      .map((item) =>
        item.comboId ? combosById.get(item.comboId)?.periodicidade : item.planoId ? planosById.get(item.planoId)?.periodicidade : null,
      )
      .filter((value): value is PeriodicidadePlano => Boolean(value)),
  );
  if (periodicities.size > 1) {
    blockers.push({
      code: 'PERIODICIDADE_INCOMPATIVEL',
      message: 'Todos os itens agrupados precisam ter a mesma periodicidade.',
    });
  }
  if (existingSubscription) {
    const targetPeriodicity =
      existingSubscription.matricula.combo?.periodicidade ??
      existingSubscription.matricula.plano?.periodicidade ??
      null;
    if (targetPeriodicity && periodicities.size > 0 && !periodicities.has(targetPeriodicity)) {
      blockers.push({
        code: 'PERIODICIDADE_INCOMPATIVEL',
        message: 'A periodicidade nao e compativel com a assinatura existente.',
      });
    }
  }
  if (existingFamilyGroup?.ciclo && periodicities.size > 0) {
    const requestedCycles = new Set<string>(
      Array.from(periodicities).map((periodicity) => mapPeriodicidadeToCycle(periodicity)),
    );
    if (!requestedCycles.has(existingFamilyGroup.ciclo)) {
      blockers.push({
        code: 'PERIODICIDADE_INCOMPATIVEL',
        message: 'A periodicidade não é compatível com o agrupamento familiar existente.',
      });
    }
  }

  if (strategy === 'CREATE_SEPARATE' && input.items.length > 1) {
    warnings.push('A cobrança separada criará uma trilha financeira por matrícula.');
  }
  if (strategy !== 'CREATE_SEPARATE' && input.items.length < 2) {
    warnings.push(
      'Você está adicionando apenas um aluno ao agrupamento. Ele será vinculado normalmente e compartilhará a cobrança existente.',
    );
  }

  const existingActiveAllocations = existingSubscription
    ? await deps.prisma.familyFinancialAllocation.aggregate({
        where: {
          contaId: input.contaId,
          sourceAgreementId: existingSubscription.id,
          chargeKind: 'MENSALIDADE',
          status: 'ACTIVE',
        },
        _sum: { amount: true },
        _max: { competenceEnd: true },
      })
    : null;
  const existingBaseAmount = existingSubscription
    ? money(existingSubscription.matricula.combo?.valor ?? existingSubscription.matricula.plano?.valor)
    : existingFamilyGroup
      ? money(existingFamilyGroup.valorMensalidadeTotal)
      : 0;
  const currentMonthlyAmount = money(
    existingBaseAmount + Number(existingActiveAllocations?._sum.amount ?? 0),
  );
  const calculatedAddedMonthlyAmount = money(
    allocations.reduce((sum, item) => sum + item.amount, 0),
  );
  const addedMonthlyAmount =
    input.enrollmentMode === 'FAMILY' && input.aggregateMonthlyAmount !== undefined
      ? money(input.aggregateMonthlyAmount)
      : calculatedAddedMonthlyAmount;
  const resultingMonthlyAmount =
    strategy === 'CREATE_SEPARATE'
      ? addedMonthlyAmount
      : money(currentMonthlyAmount + addedMonthlyAmount);

  const existingValidityEnd =
    existingActiveAllocations?._max?.competenceEnd ??
    existingFamilyGroup?.dataFimContrato ??
    existingSubscription?.matricula.dataFimContrato ??
    null;
  const resultingValidityEnd =
    existingValidityEnd && existingValidityEnd > input.dataFimContrato
      ? existingValidityEnd
      : input.dataFimContrato;

  const targetCharges: LocalChargeSnapshot[] = existingSubscription
    ? existingSubscription.matricula.cobrancas.map((charge) => ({
        id: charge.id,
        status: charge.status,
        asaasStatus: charge.asaasStatus,
        dueDate: charge.vencimento,
        competenceStart: charge.competenciaInicio,
        competenceEnd: charge.competenciaFim,
      }))
    : existingFamilySubscription
      ? (existingFamilySubscription.charges ?? []).flatMap((charge): LocalChargeSnapshot[] => {
          const dueDate = charge.dueDate ?? charge.cobranca?.vencimento ?? null;
          if (!dueDate) return [];
          return [{
            id: charge.id,
            status: charge.status,
            asaasStatus: charge.asaasStatus,
            dueDate,
            competenceStart: charge.cobranca?.competenciaInicio ?? null,
            competenceEnd: charge.cobranca?.competenciaFim ?? null,
          }];
        })
      : [];
  const currentCharge = currentChargeForDate(targetCharges, input.dataInicio);
  const currentChargeState = chargeState(currentCharge);
  const firstSeparateDueDate = resolveChargeableFirstDueDate(input.dataInicio, input.vencimentoDia);
  const targetNextDueDate =
    existingSubscription?.billingAgreement?.nextDueDate ??
    existingFamilySubscription?.billingAgreement?.nextDueDate ??
    existingFamilySubscription?.nextDueDate ??
    currentCharge?.dueDate ??
    (strategy === 'CREATE_SEPARATE' ? firstSeparateDueDate : null);
  const contractEndsBeforeApplication = Boolean(
    targetNextDueDate && dateOnly(input.dataFimContrato) < dateOnly(targetNextDueDate),
  );

  let currentCycleAction: InitialEnrollmentBillingAction;
  let operationalMessage: string;
  if (strategy === 'CREATE_SEPARATE') {
    if (contractEndsBeforeApplication) {
      currentCycleAction = 'CREATE_ONE_TIME_CHARGE';
      operationalMessage =
        'O contrato termina antes da primeira recorrência. A mensalidade deve ser emitida como cobrança avulsa, sem criar uma assinatura recorrente.';
      warnings.push(operationalMessage);
    } else {
      currentCycleAction = 'CREATE_SEPARATE';
      operationalMessage = 'Será criada uma cobrança recorrente separada para esta matrícula.';
    }
  } else if (strategy === 'UNIFY_NEXT_CYCLE') {
    currentCycleAction = 'SCHEDULE_NEXT_CYCLE';
    operationalMessage =
      'A cobrança atual será preservada e o novo valor será aplicado somente no próximo ciclo.';
    if (contractEndsBeforeApplication) {
      blockers.push({
        code: 'CONTRATO_TERMINA_ANTES_PROXIMO_CICLO',
        message:
          'O contrato termina antes do próximo ciclo da assinatura. Use cobrança separada ou inclusão no ciclo atual.',
      });
    }
    if (currentChargeState === 'OVERDUE') {
      warnings.push(
        'Há cobrança vencida no ciclo atual. Ela será preservada e deverá ser tratada separadamente pela operação financeira.',
      );
    }
  } else if (currentChargeState === 'PAID') {
    currentCycleAction = 'CREATE_COMPLEMENT';
    operationalMessage =
      'A cobrança do ciclo atual já foi paga e não será alterada. Será criada uma cobrança complementar para a nova matrícula.';
    warnings.push(operationalMessage);
  } else if (currentChargeState === 'OVERDUE' || currentChargeState === 'PROCESSING' || currentChargeState === 'CANCELLED') {
    currentCycleAction = 'MANUAL_REVIEW';
    operationalMessage =
      currentChargeState === 'OVERDUE'
        ? 'A cobrança do ciclo atual está vencida e não será alterada automaticamente.'
        : 'A cobrança do ciclo atual não pode ser alterada automaticamente neste estado.';
    blockers.push({
      code:
        currentChargeState === 'OVERDUE'
          ? 'COBRANCA_ATUAL_VENCIDA_REQUER_REVISAO'
          : 'COBRANCA_ATUAL_REQUER_REVISAO',
      message: `${operationalMessage} Escolha o próximo ciclo ou encaminhe para revisão financeira.`,
    });
  } else if (currentChargeState === 'PENDING') {
    currentCycleAction = 'UPDATE_PENDING';
    operationalMessage =
      'A cobrança pendente do ciclo atual poderá ser atualizada para o novo valor após confirmação do preflight.';
  } else {
    currentCycleAction = 'UPDATE_SUBSCRIPTION';
    operationalMessage =
      'Ainda não há cobrança emitida para o ciclo; o valor da assinatura será atualizado antes da emissão.';
  }

  const sourceSnapshot = {
    // This is a business version, not an ORM row version. Technical writes
    // performed while ensuring a customer identity must not invalidate a
    // preview that has the same enrollment terms.
    alunos: sortedById(alunos).map((aluno) => ({
      id: aluno.id,
      status: aluno.status ?? null,
      dataNasc: isoDateTime(aluno.dataNasc),
    })),
    planos: sortedById(planos).map((plano) => ({
      id: plano.id,
      status: plano.status ?? null,
      valor: money(plano.valor),
      periodicidade: plano.periodicidade,
    })),
    combos: sortedById(combos).map((combo) => ({
      id: combo.id,
      status: combo.status ?? null,
      valor: money(combo.valor),
      periodicidade: combo.periodicidade,
      vagasLimite: combo.vagasLimite ?? null,
    })),
    descontos: sortedById(descontos).map((desconto) => ({
      id: desconto.id,
      status: desconto.status ?? null,
      tipo: desconto.tipo,
      valor: money(desconto.valor),
      escopo: desconto.escopo ?? null,
    })),
    responsavel: responsavel
      ? {
          id: responsavel.id,
          cpf: responsavel.cpf,
        }
      : null,
    existingFamilyGroup: existingFamilyGroup
      ? {
          id: existingFamilyGroup.id,
          responsavelId: existingFamilyGroup.responsavelId,
          formaPagamento: existingFamilyGroup.formaPagamento,
          diaVencimento: existingFamilyGroup.diaVencimento,
          dataInicio: isoDateTime(existingFamilyGroup.dataInicio),
          dataFimContrato: isoDateTime(existingFamilyGroup.dataFimContrato),
          valorMensalidadeTotal: money(existingFamilyGroup.valorMensalidadeTotal),
          ciclo: existingFamilyGroup.ciclo,
          billingProvisionStatus: existingFamilyGroup.billingProvisionStatus,
          billingVersion: existingFamilyGroup.billingVersion,
          standaloneSubscriptionId: existingFamilyGroup.standaloneSubscriptionId,
          status: existingFamilyGroup.status,
          standaloneSubscription: existingFamilySubscription
            ? {
                id: existingFamilySubscription.id,
                status: existingFamilySubscription.status,
                asaasSubscriptionId: existingFamilySubscription.asaasSubscriptionId,
                value: money(existingFamilySubscription.value),
                nextDueDate: existingFamilySubscription.nextDueDate?.toISOString() ?? null,
                endDate: existingFamilySubscription.endDate?.toISOString() ?? null,
                remoteStatus: existingFamilySubscription.remoteStatus,
                version: existingFamilySubscription.version,
                agreementStatus: existingFamilySubscription.billingAgreement?.status ?? null,
                agreementRemoteStatus:
                  existingFamilySubscription.billingAgreement?.remoteStatus ?? null,
              }
            : null,
        }
      : null,
    existingSubscription: existingSubscription
      ? {
          id: existingSubscription.id,
          asaasSubscriptionId: existingSubscription.asaasSubscriptionId,
          matriculaId: existingSubscription.matricula.id,
          alunoId: existingSubscription.matricula.alunoId,
          currentMonthlyAmount,
          status: existingSubscription.status,
          agreementStatus: existingSubscription.billingAgreement?.status ?? null,
          agreementRemoteStatus: existingSubscription.billingAgreement?.remoteStatus ?? null,
          nextDueDate: existingSubscription.billingAgreement?.nextDueDate?.toISOString() ?? null,
        }
      : null,
    currentCharge: currentCharge
      ? {
          id: currentCharge.id,
          status: currentCharge.status,
          asaasStatus: currentCharge.asaasStatus,
          dueDate: currentCharge.dueDate.toISOString(),
          competenceStart: isoDateTime(currentCharge.competenceStart),
          competenceEnd: isoDateTime(currentCharge.competenceEnd),
        }
      : null,
  };
  const sourceVersion = hash(sourceSnapshot);
  const snapshot = {
    version: 1,
    contaId: input.contaId,
    enrollmentMode: input.enrollmentMode ?? 'INDIVIDUAL',
    familyPricingMode: input.familyPricingMode ?? null,
    aggregateMonthlyAmount:
      input.aggregateMonthlyAmount === undefined ? null : money(input.aggregateMonthlyAmount),
    aggregateEnrollmentFeeAmount:
      input.aggregateEnrollmentFeeAmount === undefined
        ? null
        : money(input.aggregateEnrollmentFeeAmount),
    strategy,
    billingStrategy,
    responsavelFinanceiroId: input.responsavelFinanceiroId ?? null,
    existingFamilyGroupId,
    financialGroupTarget,
    formaPagamento: input.formaPagamento,
    vencimentoDia: input.vencimentoDia,
    dataInicio: input.dataInicio.toISOString(),
    dataFimContrato: input.dataFimContrato.toISOString(),
    sourceVersion,
    allocations,
  };

  return {
    previewHash: hash(snapshot),
    sourceVersion,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    strategy,
    billingStrategy,
    compatibility: {
      compatible: blockers.length === 0,
      blockers,
      warnings,
    },
    totals: {
      monthlyTotal: addedMonthlyAmount,
      enrollmentFeeTotal:
        input.enrollmentMode === 'FAMILY' && input.aggregateEnrollmentFeeAmount !== undefined
          ? money(input.aggregateEnrollmentFeeAmount)
          : money(allocations.reduce((sum, item) => sum + item.enrollmentFeeAmount, 0)),
      itemCount: allocations.length,
    },
    validityImpact: {
      existingEndDate: existingValidityEnd?.toISOString() ?? null,
      addedEndDate: input.dataFimContrato.toISOString(),
      resultingEndDate:
        strategy === 'CREATE_SEPARATE' ? input.dataFimContrato.toISOString() : resultingValidityEnd.toISOString(),
      isDifferent: Boolean(
        existingValidityEnd && dateOnly(existingValidityEnd) !== dateOnly(input.dataFimContrato),
      ),
      rule:
        strategy === 'CREATE_SEPARATE'
          ? 'A matrícula terá vigência e cobrança próprias.'
          : 'Cada matrícula mantém sua vigência; a assinatura compartilhada considera a maior data final das matrículas ativas.',
    },
    billingImpact: {
      currentMonthlyAmount,
      addedMonthlyAmount,
      resultingMonthlyAmount,
      enrollmentFeeAmount: money(
        input.enrollmentMode === 'FAMILY' && input.aggregateEnrollmentFeeAmount !== undefined
          ? input.aggregateEnrollmentFeeAmount
          : allocations.reduce((sum, item) => sum + item.enrollmentFeeAmount, 0),
      ),
      application:
        strategy === 'INCLUDE_EXISTING'
          ? ('CURRENT_CYCLE' as const)
          : strategy === 'UNIFY_NEXT_CYCLE'
            ? ('NEXT_CYCLE' as const)
            : ('SEPARATE' as const),
      updatesPendingPayments: currentCycleAction === 'UPDATE_PENDING',
      currentCycleAction,
      currentChargeState,
      currentChargeId: currentCharge?.id ?? null,
      currentChargeDueDate: currentCharge?.dueDate.toISOString() ?? null,
      nextCycleDate: targetNextDueDate?.toISOString() ?? null,
      operationalMessage,
      targetLabel: existingSubscription
        ? `Assinatura de ${existingSubscription.matricula.aluno.nome}`
        : existingFamilyGroup
          ? 'Cobrança familiar existente'
          : null,
    },
    groups: [
      {
        strategy,
        payerId: input.responsavelFinanceiroId ?? null,
        existingFamilyGroupId,
        financialGroupTarget,
        allocations,
      },
    ],
    snapshot,
  };
}
