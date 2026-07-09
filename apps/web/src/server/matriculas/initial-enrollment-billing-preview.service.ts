import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import { calcularPrecoMatricula } from './matricula-pricing';

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
  deps: { prisma: PrismaLike },
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
          select: { id: true, nome: true, updatedAt: true },
        })
      : [],
    planIds.length
      ? deps.prisma.plano.findMany({
          where: { contaId: input.contaId, id: { in: planIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, updatedAt: true },
        })
      : [],
    comboIds.length
      ? deps.prisma.combo.findMany({
          where: { contaId: input.contaId, id: { in: comboIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, updatedAt: true },
        })
      : [],
    descontoIds.length
      ? deps.prisma.desconto.findMany({
          where: { contaId: input.contaId, id: { in: descontoIds }, status: 'ATIVO' },
          select: { id: true, tipo: true, valor: true, updatedAt: true },
        })
      : [],
    input.responsavelFinanceiroId
      ? deps.prisma.responsavel.findFirst({
          where: { contaId: input.contaId, id: input.responsavelFinanceiroId },
          select: { id: true, nome: true, cpf: true, email: true, telefone: true, asaasCustomerId: true },
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
            status: true,
            updatedAt: true,
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
            updatedAt: true,
            matricula: {
              select: {
                id: true,
                alunoId: true,
                responsavelFinanceiroId: true,
                formaPagamento: true,
                vencimentoDia: true,
                aluno: { select: { id: true, nome: true } },
                plano: { select: { valor: true, periodicidade: true } },
                combo: { select: { valor: true, periodicidade: true } },
              },
            },
          },
        })
      : null,
  ]);

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
      .filter(Boolean),
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

  if (strategy === 'CREATE_SEPARATE' && input.items.length > 1) {
    warnings.push('A cobrança separada criará uma trilha financeira por matrícula.');
  }
  if (strategy !== 'CREATE_SEPARATE' && input.items.length < 2) {
    warnings.push('Agrupamento financeiro costuma fazer sentido a partir de duas matrículas.');
  }

  const sourceSnapshot = {
    alunos: alunos.map((aluno) => ({ id: aluno.id, updatedAt: aluno.updatedAt.toISOString() })),
    planos: planos.map((plano) => ({ id: plano.id, updatedAt: plano.updatedAt.toISOString(), valor: money(plano.valor) })),
    combos: combos.map((combo) => ({ id: combo.id, updatedAt: combo.updatedAt.toISOString(), valor: money(combo.valor) })),
    descontos: descontos.map((desconto) => ({ id: desconto.id, updatedAt: desconto.updatedAt.toISOString(), valor: money(desconto.valor) })),
    responsavel: responsavel
      ? {
          id: responsavel.id,
          nome: responsavel.nome,
          cpf: responsavel.cpf,
          email: responsavel.email,
          telefone: responsavel.telefone,
          asaasCustomerId: responsavel.asaasCustomerId,
        }
      : null,
    existingFamilyGroup: existingFamilyGroup
      ? { id: existingFamilyGroup.id, updatedAt: existingFamilyGroup.updatedAt.toISOString() }
      : null,
    existingSubscription: existingSubscription
      ? {
          id: existingSubscription.id,
          asaasSubscriptionId: existingSubscription.asaasSubscriptionId,
          updatedAt: existingSubscription.updatedAt.toISOString(),
          matriculaId: existingSubscription.matricula.id,
          alunoId: existingSubscription.matricula.alunoId,
        }
      : null,
  };
  const sourceVersion = hash(sourceSnapshot);
  const snapshot = {
    version: 1,
    contaId: input.contaId,
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
      monthlyTotal: money(allocations.reduce((sum, item) => sum + item.amount, 0)),
      enrollmentFeeTotal: money(allocations.reduce((sum, item) => sum + item.enrollmentFeeAmount, 0)),
      itemCount: allocations.length,
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
