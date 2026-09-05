import {
  BillingMode,
  ChargeStatus,
  EnrollmentCreationOperationStatus,
  FormaPagamento,
  MatriculaBillingProvisionStatus,
  Prisma,
  StatusCobranca,
  StatusFinanceiro,
  StatusMatricula,
  StatusTaxaMatricula,
  TipoCobranca,
} from '@prisma/client';
import type { Cobranca, PrismaClient } from '@prisma/client';
import { prisma } from '@/src/prisma';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  resolvePayer,
  validarCapacidade,
  validarConflitosHorario,
  validarDatasContrato,
  validateTransition,
  canEditStructural,
} from '@alusa/domain';
import {
  buildSeatOccupancyOverlapWhereClause,
  buildSeatOccupancyWhereClause,
} from '@alusa/lib';
import {
  materializeBillingAgreement,
  mapAsaasPaymentStatusToCharge,
  mapAsaasPaymentStatusToCobranca,
  reconcileAcademicChargesWithAsaas,
  type AsaasBillingType,
  type Cycle,
  type StagedEnrollmentFinancialResources,
} from '@alusa/finance';
import { resolveFirstDueDate } from '@/src/server/matriculas/recurring-billing';
import {
  resolveInitialBillingProvisionStatus,
} from '@/src/server/matriculas/billing-provision-status';
import {
  assertStudentCapacity,
  countAdditionalActiveStudentsForEnrollment,
} from '@/src/server/platform-billing/capacity';
import {
  calcularPrecoMatricula,
  round2,
  type CalcularPrecoInput,
  type CalcularPrecoOutput,
  type DescontoInput,
} from './matricula-pricing';
import {
  previewInitialEnrollmentBilling,
  type CanonicalEnrollmentBillingStrategy,
} from './initial-enrollment-billing-preview.service';
import { createPendingEnrollmentContract } from '@/src/server/contracts/create-pending-enrollment-contract.service';

export { calcularPrecoMatricula };
export type { CalcularPrecoInput, CalcularPrecoOutput, DescontoInput };

export class MatriculaConflictError extends Error {
  readonly code:
    | 'MATRICULA_DUPLICADA_TURMA'
    | 'MATRICULA_DUPLICADA_COMBO'
    | 'TURMA_SEM_VAGAS'
    | 'COMBO_SEM_VAGAS'
    | 'CONFLITO_HORARIO';

  constructor(
    code:
      | 'MATRICULA_DUPLICADA_TURMA'
      | 'MATRICULA_DUPLICADA_COMBO'
      | 'TURMA_SEM_VAGAS'
      | 'COMBO_SEM_VAGAS'
      | 'CONFLITO_HORARIO',
    message: string,
  ) {
    super(message);
    this.name = 'MatriculaConflictError';
    this.code = code;
  }
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function findExistingMatriculaByUiRequestId(input: {
  contaId: string;
  uiRequestId: string;
}) {
  return prisma.matricula.findFirst({
    where: { contaId: input.contaId, uiRequestId: input.uiRequestId },
    include: {
      cobrancas: {
        orderBy: { createdAt: 'asc' },
      },
      descontos: { include: { desconto: true } },
      plano: { select: { valor: true } },
      combo: { select: { valor: true } },
    },
  });
}

export async function buildCriarMatriculaResultFromExisting(
  matricula: NonNullable<Awaited<ReturnType<typeof findExistingMatriculaByUiRequestId>>>,
) {
  const planoValor = matricula.combo
    ? Number(matricula.combo.valor)
    : matricula.plano
      ? Number(matricula.plano.valor)
      : Number(matricula.taxaMatricula);

  const preco = calcularPrecoMatricula({
    planoValor,
    taxaMatricula: Number(matricula.taxaMatricula),
    descontos: matricula.descontos.map((item) => ({
      tipo: item.desconto.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
      valor: Number(item.desconto.valor),
      cumulativo: false,
    })),
  });

  const primeiroVencimento = resolveFirstDueDate(matricula.dataInicio, matricula.vencimentoDia);

  return {
    matricula,
    cobrancas: {
      taxa:
        matricula.cobrancas.find(
          (cobranca) => cobranca.tipo === TipoCobranca.TAXA_MATRICULA,
        ) ?? null,
      mensalidade:
        matricula.cobrancas.find(
          (cobranca) => cobranca.tipo === TipoCobranca.MENSALIDADE,
        ) ?? null,
    },
    preco,
    responsavelFinanceiro: null,
    primeiroVencimento,
    contratoId: matricula.contratoAtualId,
    contratoPublicToken: null,
    contratoTokenExpiraEm: null,
    idempotent: true as const,
  };
}

type MatriculaPersistence = {
  matricula: {
    findFirst: (_args: Prisma.MatriculaFindFirstArgs) => Promise<{ id: string } | null>;
  };
};

async function assertNoDuplicateEnrollment(
  db: MatriculaPersistence,
  params: {
    contaId: string;
    alunoId: string;
    turmaId?: string | null;
    turmaIds?: string[];
    comboId?: string | null;
    excludeMatriculaId?: string;
    dataInicio: Date;
    dataFimContrato: Date;
  },
) {
  const occupancyWhere = buildSeatOccupancyOverlapWhereClause(
    params.dataInicio,
    params.dataFimContrato,
  );
  const targetTurmaIds = Array.from(
    new Set([params.turmaId, ...(params.turmaIds ?? [])].filter((id): id is string => Boolean(id))),
  );
  if (targetTurmaIds.length > 0) {
    const existingByTurma = await db.matricula.findFirst({
      where: {
        contaId: params.contaId,
        alunoId: params.alunoId,
        OR: [
          { turmaId: { in: targetTurmaIds } },
          { matriculaTurmas: { some: { turmaId: { in: targetTurmaIds } } } },
        ],
        ...occupancyWhere,
        ...(params.excludeMatriculaId ? { NOT: { id: params.excludeMatriculaId } } : {}),
      },
      select: { id: true },
    });

    if (existingByTurma) {
      throw new MatriculaConflictError(
        'MATRICULA_DUPLICADA_TURMA',
        'Este aluno já está matriculado nesta turma.',
      );
    }
  }

  if (params.comboId) {
    const existingByCombo = await db.matricula.findFirst({
      where: {
        contaId: params.contaId,
        alunoId: params.alunoId,
        comboId: params.comboId,
        ...occupancyWhere,
        ...(params.excludeMatriculaId ? { NOT: { id: params.excludeMatriculaId } } : {}),
      },
      select: { id: true },
    });

    if (existingByCombo) {
      throw new MatriculaConflictError(
        'MATRICULA_DUPLICADA_COMBO',
        'Este aluno já possui uma matrícula ativa neste combo.',
      );
    }
  }
}

type EnrollmentTargetTurma = {
  id: string;
  nome: string;
  capacidade: number;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
};

async function assertTargetTurmasAvailable(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    contaId: string;
    alunoId: string;
    targetTurmas: EnrollmentTargetTurma[];
    dataInicio: Date;
    dataFimContrato: Date;
    excludeMatriculaId?: string;
  },
) {
  const overlap = buildSeatOccupancyOverlapWhereClause(
    params.dataInicio,
    params.dataFimContrato,
  );

  for (const targetTurma of params.targetTurmas) {
    const ocupadas = await db.matricula.count({
      where: {
        contaId: params.contaId,
        OR: [
          { turmaId: targetTurma.id },
          { matriculaTurmas: { some: { turmaId: targetTurma.id } } },
        ],
        ...overlap,
        ...(params.excludeMatriculaId ? { NOT: { id: params.excludeMatriculaId } } : {}),
      },
    });
    const capacity = validarCapacidade([
      {
        id: targetTurma.id,
        nome: targetTurma.nome,
        capacidade: targetTurma.capacidade,
        matriculasOcupantes: ocupadas,
      },
    ]);
    if (!capacity.success) {
      throw new MatriculaConflictError(
        'TURMA_SEM_VAGAS',
        `Turma "${targetTurma.nome}" não possui vagas disponíveis.`,
      );
    }
  }

  const existingEnrollments = await db.matricula.findMany({
    where: {
      contaId: params.contaId,
      alunoId: params.alunoId,
      ...overlap,
      ...(params.excludeMatriculaId ? { NOT: { id: params.excludeMatriculaId } } : {}),
    },
    include: {
      turma: {
        select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
      },
      matriculaTurmas: {
        include: {
          turma: {
            select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
          },
        },
      },
    },
  });
  const existingTurmas = Array.from(
    new Map(
      existingEnrollments
        .flatMap((enrollment) => [
          enrollment.turma,
          ...enrollment.matriculaTurmas.map((item) => item.turma),
        ])
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .map((item) => [item.id, item]),
    ).values(),
  );
  const schedule = validarConflitosHorario(
    params.targetTurmas,
    [...existingTurmas, ...params.targetTurmas],
  );
  if (!schedule.success) {
    throw new MatriculaConflictError(
      'CONFLITO_HORARIO',
      `Conflito de horário entre "${schedule.turma1}" e "${schedule.turma2}".`,
    );
  }
}

export type ListarMatriculasInput = {
  contaId: string;
  alunoId?: string;
  planoId?: string;
  turmaId?: string;
  comboId?: string | null;
  status?: StatusMatricula[];
  excludeStatus?: StatusMatricula[];
  search?: string;
  page: number;
  pageSize: number;
};

export async function listarMatriculas(input: ListarMatriculasInput) {
  const page = Number.isFinite(input.page) ? input.page : 1;
  const pageSize = Number.isFinite(input.pageSize) ? input.pageSize : 20;
  const skip = Math.max(0, (page - 1) * pageSize);

  const where: Prisma.MatriculaWhereInput = {
    aluno: {
      contaId: input.contaId,
    },
    ...(input.alunoId ? { alunoId: input.alunoId } : {}),
    ...(input.planoId ? { planoId: input.planoId } : {}),
    ...(input.comboId !== undefined ? { comboId: input.comboId } : {}),
    ...(input.status?.length ? { status: { in: input.status } } : {}),
  };

  const andFilters: Prisma.MatriculaWhereInput[] = [];

  if (input.turmaId) {
    const referenceDate = new Date();
    andFilters.push(
      {
        OR: [
          { turmaId: input.turmaId },
          { matriculaTurmas: { some: { turmaId: input.turmaId } } },
        ],
      },
      { status: { notIn: [StatusMatricula.ENCERRADA, StatusMatricula.CANCELADA, StatusMatricula.RECUSADA] } },
      { dataInicio: { lte: referenceDate } },
      { dataFimContrato: { gte: referenceDate } },
    );
  }

  if (input.search?.trim()) {
    andFilters.push({
      OR: [
        { aluno: { nome: { contains: input.search.trim(), mode: 'insensitive' as const } } },
        { aluno: { cpf: { contains: input.search.trim() } } },
      ],
    });
  }

  if (andFilters.length) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...andFilters];
  }

  if (input.excludeStatus?.length) {
    if (where.status) {
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, { status: { notIn: input.excludeStatus } }];
    } else {
      where.status = { notIn: input.excludeStatus };
    }
  }

  const [total, dataRaw] = await Promise.all([
    prisma.matricula.count({ where }),
    prisma.matricula.findMany({
      where,
      orderBy: { dataInicio: 'desc' },
      skip,
      take: pageSize,
      include: {
        aluno: { select: { id: true, nome: true, cpf: true, foto: true } },
        plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        turma: {
          select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
        },
        matriculaTurmas: {
          include: {
            turma: {
              select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
            },
          },
        },
        combo: { select: { id: true, nome: true, periodicidade: true, valor: true } },
        cobrancas: { orderBy: { vencimento: 'asc' } },
        responsavelFinanceiro: {
          select: { id: true, nome: true, cpf: true, email: true, telefone: true },
        },
        contratos: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            tokenPublico: true,
            tokenExpiraEm: true,
            createdAt: true,
            modelo: { select: { nome: true } },
          },
        },
      },
    }),
  ]);

  const cobrancaIds = dataRaw.flatMap((matricula) =>
    matricula.cobrancas
      .filter((cobranca) => cobranca.asaasPaymentId)
      .map((cobranca) => cobranca.id),
  );
  const reconciliation = cobrancaIds.length
    ? await reconcileAcademicChargesWithAsaas({
        contaId: input.contaId,
        cobrancaIds,
        limit: cobrancaIds.length,
      })
    : null;
  const data = dataRaw.map((matricula) => ({
    ...matricula,
    taxaStatus:
      matricula.taxaStatus === StatusTaxaMatricula.PAGO ||
      matricula.cobrancas.some((cobranca) => {
        const reconciled = reconciliation?.items.get(cobranca.id);
        return cobranca.tipo === TipoCobranca.TAXA_MATRICULA && reconciled?.status === StatusCobranca.PAGO;
      })
        ? StatusTaxaMatricula.PAGO
        : matricula.taxaStatus,
    cobrancas: matricula.cobrancas.map((cobranca) => {
      const reconciled = reconciliation?.items.get(cobranca.id);
      return reconciled
        ? {
            ...cobranca,
            status: reconciled.status,
            asaasPaymentId: reconciled.asaasPaymentId,
            asaasStatus: reconciled.asaasStatus,
            vencimento: reconciled.vencimento,
            dataPagamento: reconciled.dataPagamento,
            pagoEm: reconciled.pagoEm,
            liquidacaoStatus: reconciled.liquidacaoStatus,
            liquidadoEm: reconciled.liquidadoEm,
          }
        : cobranca;
    }),
  }));

  const normalized = data.map((item) => ({
    ...item,
    turmas: item.matriculaTurmas.map((mt) => mt.turma).filter(Boolean),
  }));

  return { data: normalized, total, page, pageSize };
}

export type CriarMatriculaInput = {
  notificationChannels?: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>;
  notificationChannelsConfigured?: boolean;
  contaId: string;
  alunoId: string;
  planoId?: string | null;
  turmaId?: string | null;
  comboId?: string | null;
  responsavelFinanceiroId?: string | null;
  dataInicio: Date;
  dataFimContrato: Date;
  vencimentoDia: number;
  taxaMatricula: number;
  taxaIsenta: boolean;
  taxaJustificativa?: string | null;
  pagarTaxaAgora: boolean;
  gerarCobrancaTaxa: boolean;
  criarCobranca: boolean;
  /** Mantém a matrícula pendente até uma operação financeira externa ser confirmada. */
  requiresFinancialProvisioning?: boolean;
  billingMode?: BillingMode | null;
  matriculaFamiliarId?: string | null;
  familyOrderIndex?: number | null;
  valorMensalidadeOverride?: number | null;
  formaPagamento?: FormaPagamento;
  formaPagamentoTaxa?: FormaPagamento;
  createdById: string;
  modeloId: string;
  /** Juros mensal em percentual (ex: 1.0 = 1%) */
  jurosMensal?: number | null;
  /** Multa por atraso em percentual (ex: 2.0 = 2%) */
  multaPercentual?: number | null;
  /** Desconto para pagamento antecipado em percentual (ex: 5.0 = 5%) */
  descontoAntecipado?: number | null;
  /** Tipo de desconto: FIXED ou PERCENTAGE */
  descontoTipo?: 'FIXED' | 'PERCENTAGE' | null;
  /** Prazo limite para desconto (dias antes do vencimento) */
  prazoDesconto?: number | null;
  /** Benefícios/descontos comerciais aplicados à mensalidade */
  descontoIds?: string[] | null;
  /** Idempotência opcional (header X-Idempotency-Key ou body) */
  uiRequestId?: string | null;
  billingStrategy?: CanonicalEnrollmentBillingStrategy | null;
  billingPreview?: {
    previewHash: string;
    sourceVersion: string;
    previewExpiresAt: Date;
    billingStrategy: CanonicalEnrollmentBillingStrategy;
  } | null;
  /** Artefatos já confirmados no Asaas pela saga síncrona de criação. */
  preprovisionedBilling?: (StagedEnrollmentFinancialResources & {
    billingType: AsaasBillingType;
    enrollmentFeeBillingType: AsaasBillingType | null;
    cycle: Cycle;
    nextDueDate: string;
    endDate: string;
  }) | null;
};

type DescontoMatriculaAplicavel = {
  id: string;
  nome: string;
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  escopo: string;
  cumulativo?: boolean;
};

async function resolveDescontosMatricula(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    descontoIds?: string[] | null;
  },
): Promise<DescontoMatriculaAplicavel[]> {
  const descontos = new Map<string, DescontoMatriculaAplicavel>();
  const descontoIds = Array.from(new Set((params.descontoIds ?? []).filter(Boolean)));

  if (descontoIds.length > 0) {
    const records = await tx.desconto.findMany({
      where: {
        contaId: params.contaId,
        id: { in: descontoIds },
        status: 'ATIVO',
      },
      select: {
        id: true,
        nome: true,
        tipo: true,
        valor: true,
        escopo: true,
      },
    });

    if (records.length !== descontoIds.length) {
      throw new Error('Um ou mais benefícios selecionados não estão disponíveis.');
    }

    for (const record of records) {
      descontos.set(record.id, {
        id: record.id,
        nome: record.nome,
        tipo: record.tipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO',
        valor: Number(record.valor),
        escopo: record.escopo,
      });
    }
  }

  return Array.from(descontos.values());
}

async function aplicarDescontosMatricula(
  tx: Prisma.TransactionClient,
  matriculaId: string,
  descontos: DescontoMatriculaAplicavel[],
  planoValor: number,
  calc: CalcularPrecoOutput,
) {
  if (!descontos.length || !calc.descontosAplicados.length) return;

  const detalhes = descontos
    .map((desconto) => ({
      desconto,
      valorAplicado:
        desconto.tipo === 'PERCENTUAL'
          ? round2(planoValor * (desconto.valor / 100))
          : round2(desconto.valor),
    }))
    .sort((a, b) => b.valorAplicado - a.valorAplicado);

  const restantes = [...calc.descontosAplicados];
  for (const item of detalhes) {
    const index = restantes.findIndex((valor) => Math.abs(valor - item.valorAplicado) < 0.01);
    if (index < 0) continue;

    await tx.descontoMatricula.create({
      data: {
        matriculaId,
        descontoId: item.desconto.id,
        valorFinal: new Prisma.Decimal(item.valorAplicado),
      },
    });

    restantes.splice(index, 1);
    if (!restantes.length) break;
  }
}

function normalizePaymentForPreview(value?: FormaPagamento | null) {
  if (value === FormaPagamento.PIX) return 'PIX';
  if (value === FormaPagamento.CARTAO_CREDITO) {
    return 'CARTAO_CREDITO';
  }
  return 'BOLETO';
}

function resolveBillingStrategy(input: CriarMatriculaInput): CanonicalEnrollmentBillingStrategy {
  return input.billingPreview?.billingStrategy ?? input.billingStrategy ?? { kind: 'SEPARATE' };
}

function parseSubscriptionBillingTarget(strategy: CanonicalEnrollmentBillingStrategy) {
  if (
    strategy.kind !== 'JOIN_EXISTING_CURRENT_CYCLE' &&
    strategy.kind !== 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
  ) return null;
  const prefix = 'subscription:';
  return strategy.financialGroupId.startsWith(prefix)
    ? strategy.financialGroupId.slice(prefix.length)
    : null;
}

async function assertInitialEnrollmentBillingPreview(
  tx: Prisma.TransactionClient,
  input: CriarMatriculaInput,
) {
  if (!input.billingPreview) return;

  if (input.billingPreview.previewExpiresAt <= new Date()) {
    throw new Error('PREVIEW_EXPIRADO');
  }

  const billingStrategy = input.billingPreview.billingStrategy;
  const preview = await previewInitialEnrollmentBilling(
    {
      contaId: input.contaId,
      billingStrategy,
      responsavelFinanceiroId: input.responsavelFinanceiroId ?? null,
      existingFamilyGroupId:
        billingStrategy.kind === 'SEPARATE' ? null : billingStrategy.financialGroupId,
      dataInicio: input.dataInicio,
      dataFimContrato: input.dataFimContrato,
      formaPagamento: normalizePaymentForPreview(input.formaPagamento),
      vencimentoDia: input.vencimentoDia,
      descontoIds: input.descontoIds ?? [],
      items: [
        {
          alunoId: input.alunoId,
          turmaId: input.turmaId ?? null,
          comboId: input.comboId ?? null,
          planoId: input.planoId ?? null,
          taxaMatricula: input.taxaMatricula,
          valorMensalidadeOverride: input.valorMensalidadeOverride ?? null,
        },
      ],
    },
    { prisma: tx },
  );

  if (!preview.compatibility.compatible) {
    const first = preview.compatibility.blockers[0];
    const message = first?.message ?? 'Preview financeiro incompatível.';
    throw new Error(`PREVIEW_INCOMPATIVEL:${first?.code ?? 'UNKNOWN'}:${message}`);
  }

  if (
    preview.previewHash.toLowerCase() !== input.billingPreview.previewHash.toLowerCase() ||
    preview.sourceVersion.toLowerCase() !== input.billingPreview.sourceVersion.toLowerCase()
  ) {
    throw new Error('PREVIEW_DESATUALIZADO');
  }
}

async function persistInitialEnrollmentFinancialAllocations(
  tx: Prisma.TransactionClient,
  params: {
    input: CriarMatriculaInput;
    matriculaId: string;
    preco: CalcularPrecoOutput;
  },
) {
  const strategy = resolveBillingStrategy(params.input);
  const subscriptionTargetId = parseSubscriptionBillingTarget(strategy);
  const familyGroupId =
    strategy.kind === 'SEPARATE' || subscriptionTargetId
      ? null
      : strategy.financialGroupId.replace(/^family:/, '');
  const rows: Prisma.FamilyFinancialAllocationCreateManyInput[] = [];
  const metadataBase = {
    source: 'MATRICULA_INICIAL',
    billingStrategy: strategy,
    subscriptionTargetId,
    billingMode: params.input.billingMode ?? BillingMode.INDIVIDUAL,
    formaPagamento: params.input.formaPagamento ?? FormaPagamento.BOLETO,
    vencimentoDia: params.input.vencimentoDia,
    descontoIds: params.input.descontoIds ?? [],
    uiRequestId: params.input.uiRequestId ?? null,
  } as Prisma.InputJsonValue;

  if (params.input.criarCobranca && params.preco.planoLiquido > 0) {
    rows.push({
      contaId: params.input.contaId,
      alunoId: params.input.alunoId,
      matriculaId: params.matriculaId,
      familyGroupId,
      chargeKind: 'MENSALIDADE',
      status: 'PENDING',
      amount: params.preco.planoLiquido,
      baseAmount: params.preco.plano,
      discountAmount: round2(params.preco.plano - params.preco.planoLiquido),
      competenceStart: params.input.dataInicio,
      competenceEnd: params.input.dataFimContrato,
      metadata: metadataBase,
    });
  }

  if (
    !params.input.taxaIsenta &&
    params.input.gerarCobrancaTaxa &&
    params.input.taxaMatricula > 0
  ) {
    rows.push({
      contaId: params.input.contaId,
      alunoId: params.input.alunoId,
      matriculaId: params.matriculaId,
      familyGroupId,
      chargeKind: 'TAXA_MATRICULA',
      status: 'PENDING',
      amount: params.input.taxaMatricula,
      baseAmount: params.input.taxaMatricula,
      discountAmount: 0,
      competenceStart: params.input.dataInicio,
      competenceEnd: params.input.dataInicio,
      metadata: metadataBase,
    });
  }

  if (rows.length > 0) {
    await tx.familyFinancialAllocation.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }
}

export async function criarMatricula(input: CriarMatriculaInput) {
  if (input.uiRequestId) {
    const existing = await findExistingMatriculaByUiRequestId({
      contaId: input.contaId,
      uiRequestId: input.uiRequestId,
    });
    if (existing) {
      return buildCriarMatriculaResultFromExisting(existing);
    }
  }

  const aluno = await prisma.aluno.findFirst({
    where: { id: input.alunoId, contaId: input.contaId },
    select: { id: true, status: true, dataNasc: true },
  });
  if (!aluno) throw new Error('Aluno não encontrado');
  if (aluno.status !== 'ATIVO') {
    throw new Error('Aluno inativo não pode receber nova matrícula');
  }

  if (!input.turmaId && !input.comboId) {
    throw new Error('É necessário selecionar uma turma ou um combo.');
  }

  await assertNoDuplicateEnrollment(prisma, {
    contaId: input.contaId,
    alunoId: input.alunoId,
    turmaId: input.turmaId,
    comboId: input.comboId,
    dataInicio: input.dataInicio,
    dataFimContrato: input.dataFimContrato,
  });

  // Validar datas de contrato
  const datasResult = validarDatasContrato(input.dataInicio, input.dataFimContrato, {
    permitirInicioPassado: true,
  });
  if (!datasResult.success) {
    throw new Error(
      datasResult.error === 'DATA_FIM_ANTES_INICIO'
        ? 'Data de fim do contrato deve ser posterior à data de início.'
        : 'Data de início não pode ser no passado.',
    );
  }

  const requiresPayer = input.criarCobranca || input.gerarCobrancaTaxa || input.pagarTaxaAgora;

  // Validar pagador usando função canônica do domínio
  if (requiresPayer) {
    const payerResult = resolvePayer({
      alunoId: aluno.id,
      alunoDataNasc: aluno.dataNasc,
      responsavelFinanceiroId: input.responsavelFinanceiroId,
    });

    if (!payerResult.success) {
      throw new Error('Responsável financeiro é obrigatório para alunos menores de 18 anos.');
    }
  }

  // Buscar turma com capacidade para validação
  const [plano, combo, turma] = await Promise.all([
    input.planoId
      ? prisma.plano.findFirst({
          where: { id: input.planoId, contaId: input.contaId },
          select: { id: true, valor: true, periodicidade: true },
        })
      : Promise.resolve(null),
    input.comboId
      ? prisma.combo.findFirst({
          where: { id: input.comboId, contaId: input.contaId },
          select: {
            id: true,
            valor: true,
            periodicidade: true,
            vagasLimite: true,
            turmas: {
              select: {
                turmaId: true,
                turma: {
                  select: {
                    id: true,
                    nome: true,
                    capacidade: true,
                    diasSemana: true,
                    horaInicio: true,
                    horaFim: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
    input.turmaId
      ? prisma.turma.findFirst({
          where: { id: input.turmaId, contaId: input.contaId },
          select: {
            id: true,
            nome: true,
            capacidade: true,
            diasSemana: true,
            horaInicio: true,
            horaFim: true,
          },
        })
      : Promise.resolve(null),
  ]);

  const targetTurmas = turma ? [turma] : combo?.turmas.map((item) => item.turma) ?? [];

  // Validar capacidade de cada turma, inclusive as turmas internas de combos.
  for (const targetTurma of targetTurmas) {
    const ocupadas = await prisma.matricula.count({
      where: {
        contaId: input.contaId,
        OR: [
          { turmaId: targetTurma.id },
          { matriculaTurmas: { some: { turmaId: targetTurma.id } } },
        ],
        ...buildSeatOccupancyOverlapWhereClause(input.dataInicio, input.dataFimContrato),
      },
    });
    const capResult = validarCapacidade([
      {
        id: targetTurma.id,
        nome: targetTurma.nome,
        capacidade: targetTurma.capacidade,
        matriculasOcupantes: ocupadas,
      },
    ]);
    if (!capResult.success) {
      throw new MatriculaConflictError(
        'TURMA_SEM_VAGAS',
        `Turma "${targetTurma.nome}" não possui vagas disponíveis.`,
      );
    }
  }

  if (combo) {
    if ((combo as { vagasLimite?: number | null }).vagasLimite != null) {
      const comboOcupadas = await prisma.matricula.count({
        where: {
          contaId: input.contaId,
          comboId: combo.id,
          ...buildSeatOccupancyOverlapWhereClause(input.dataInicio, input.dataFimContrato),
        },
      });
      const capResult = validarCapacidade([], {
        vagasLimite: (combo as { vagasLimite?: number | null }).vagasLimite,
        matriculasOcupantes: comboOcupadas,
      });
      if (!capResult.success) {
        throw new MatriculaConflictError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis.');
      }
    }
  }

  // Validar conflitos de horário para turma individual e todas as turmas do combo.
  if (targetTurmas.length > 0) {
    const matriculasExistentes = await prisma.matricula.findMany({
      where: {
        contaId: input.contaId,
        alunoId: input.alunoId,
        ...buildSeatOccupancyOverlapWhereClause(input.dataInicio, input.dataFimContrato),
      },
      include: {
        turma: {
          select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
        },
        matriculaTurmas: {
          include: {
            turma: {
              select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
            },
          },
        },
      },
    });
    const turmasExistentes = Array.from(
      new Map(
        matriculasExistentes
          .flatMap((matriculaExistente) => [
            matriculaExistente.turma,
            ...matriculaExistente.matriculaTurmas.map((item) => item.turma),
          ])
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map((item) => [item.id, item]),
      ).values(),
    );

    const conflitosResult = validarConflitosHorario(
      targetTurmas,
      [...turmasExistentes, ...targetTurmas],
    );
    if (!conflitosResult.success) {
      throw new MatriculaConflictError(
        'CONFLITO_HORARIO',
        `Conflito de horário entre "${conflitosResult.turma1}" e "${conflitosResult.turma2}".`,
      );
    }
  }

  const valorOverride = Number(input.valorMensalidadeOverride ?? 0);
  const planoValor =
    Number.isFinite(valorOverride) && valorOverride > 0
      ? valorOverride
      : combo
        ? Number(combo.valor)
        : plano
          ? Number(plano.valor)
          : 0;

  const primeiroVencimento = resolveFirstDueDate(input.dataInicio, input.vencimentoDia);

  let result;
  try {
    result = await runWithTenant(input.contaId, async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${input.alunoId}))
    `;
    await assertInitialEnrollmentBillingPreview(tx, input);

    await assertNoDuplicateEnrollment(tx, {
      contaId: input.contaId,
      alunoId: input.alunoId,
      turmaId: input.turmaId,
      comboId: input.comboId,
      turmaIds: combo?.turmas.map((item) => item.turmaId) ?? [],
      dataInicio: input.dataInicio,
      dataFimContrato: input.dataFimContrato,
    });

    await assertTargetTurmasAvailable(tx, {
      contaId: input.contaId,
      alunoId: input.alunoId,
      targetTurmas,
      dataInicio: input.dataInicio,
      dataFimContrato: input.dataFimContrato,
    });

    if (combo?.vagasLimite != null) {
      const comboOcupadas = await tx.matricula.count({
        where: {
          contaId: input.contaId,
          comboId: combo.id,
          ...buildSeatOccupancyOverlapWhereClause(input.dataInicio, input.dataFimContrato),
        },
      });
      const comboCapacity = validarCapacidade([], {
        vagasLimite: combo.vagasLimite,
        matriculasOcupantes: comboOcupadas,
      });
      if (!comboCapacity.success) {
        throw new MatriculaConflictError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis.');
      }
    }

    // Determinar status inicial baseado na política da conta
    const conta = await tx.conta.findUnique({
      where: { id: input.contaId },
      select: { matriculaActivationPolicy: true },
    });
    const policy = conta?.matriculaActivationPolicy ?? 'IMMEDIATE';

    const requiresDeferredBillingConfirmation =
      (input.criarCobranca || input.requiresFinancialProvisioning === true) &&
      !input.preprovisionedBilling;

    let statusInicial: StatusMatricula;
    if (requiresDeferredBillingConfirmation) {
      // Estratégias que alteram uma assinatura existente só se tornam matrícula
      // efetiva depois que o comando financeiro síncrono for confirmado.
      statusInicial = StatusMatricula.AGUARDANDO_CONFIRMACAO;
    } else if (policy === 'REQUIRES_PAYMENT' && !input.taxaIsenta && input.taxaMatricula > 0) {
      statusInicial = StatusMatricula.PENDENTE_TAXA;
    } else {
      statusInicial = StatusMatricula.ATIVA;
    }

    if (statusInicial === StatusMatricula.ATIVA) {
      const additionalActiveStudents = await countAdditionalActiveStudentsForEnrollment({
        tx,
        contaId: input.contaId,
        alunoId: input.alunoId,
      });
      await assertStudentCapacity({
        tx,
        contaId: input.contaId,
        additionalActiveStudents,
        operation: 'matricula.create',
      });
    }

    const descontosAplicaveis = await resolveDescontosMatricula(tx, {
      contaId: input.contaId,
      descontoIds: input.descontoIds,
    });

    const preco = calcularPrecoMatricula({
      planoValor,
      taxaMatricula: input.taxaMatricula,
      descontos: descontosAplicaveis.map((desconto) => ({
        tipo: desconto.tipo,
        valor: desconto.valor,
        cumulativo: desconto.cumulativo,
      })),
    });

    const billingStrategy = resolveBillingStrategy(input);
    const subscriptionTargetId = parseSubscriptionBillingTarget(billingStrategy);
    const resolvedBillingMode =
      billingStrategy.kind === 'SEPARATE' ? (input.billingMode ?? BillingMode.INDIVIDUAL) : BillingMode.SHARED_PLAN;
    const billingProvisionStatus = input.preprovisionedBilling
      ? MatriculaBillingProvisionStatus.PROVISIONADO
      : input.requiresFinancialProvisioning === true
        ? MatriculaBillingProvisionStatus.PENDENTE
      : subscriptionTargetId && input.criarCobranca && preco.planoLiquido > 0
        ? MatriculaBillingProvisionStatus.PENDENTE
        : resolveInitialBillingProvisionStatus({
            billingMode: resolvedBillingMode,
            criarCobranca: input.criarCobranca,
            gerarCobrancaTaxa: input.gerarCobrancaTaxa,
            taxaIsenta: input.taxaIsenta,
            taxaMatricula: input.taxaMatricula,
            planoLiquido: preco.planoLiquido,
          });

    const stagedBilling = input.preprovisionedBilling;
    if (stagedBilling) {
      const [stagedOperation, stagedCustomer] = await Promise.all([
        tx.enrollmentCreationOperation.findFirst({
          where: {
            id: stagedBilling.operationId,
            contaId: input.contaId,
            status: EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
            asaasSubscriptionId: stagedBilling.subscription.asaasSubscriptionId,
            asaasFirstPaymentId: stagedBilling.subscription.firstPayment.asaasPaymentId,
            asaasEnrollmentFeePaymentId:
              stagedBilling.enrollmentFee?.asaasPaymentId ?? null,
          },
          select: { id: true },
        }),
        tx.customer.findFirst({
          where: {
            id: stagedBilling.customer.localCustomerId,
            contaId: input.contaId,
          },
          select: { id: true },
        }),
      ]);
      if (!stagedOperation || !stagedCustomer) {
        throw new Error('PREPROVISIONED_BILLING_TENANT_MISMATCH');
      }
    }

    const matricula = await tx.matricula.create({
      data: {
        contaId: input.contaId,
        alunoId: input.alunoId,
        responsavelFinanceiroId: input.responsavelFinanceiroId ?? undefined,
        turmaId: input.turmaId ?? undefined,
        planoId: input.planoId ?? undefined,
        comboId: input.comboId ?? undefined,
        billingMode: resolvedBillingMode,
        matriculaFamiliarId: input.matriculaFamiliarId ?? undefined,
        uiRequestId: input.uiRequestId ?? undefined,
        billingProvisionStatus,
        dataInicio: input.dataInicio,
        dataFimContrato: input.dataFimContrato,
        taxaMatricula: input.taxaMatricula,
        taxaIsenta: input.taxaIsenta,
        taxaJustificativa: input.taxaJustificativa ?? undefined,
        formaPagamento: input.formaPagamento ?? FormaPagamento.BOLETO,
        vencimentoDia: input.vencimentoDia,
        status: statusInicial,
        taxaStatus: input.taxaIsenta ? StatusTaxaMatricula.ISENTO : StatusTaxaMatricula.PENDENTE,
        statusFinanceiro: input.taxaIsenta
          ? StatusFinanceiro.ADIMPLENTE
          : StatusFinanceiro.PENDENTE_TAXA,
        // Campos de juros, multa e desconto
        jurosMensal: input.jurosMensal ?? null,
        multaPercentual: input.multaPercentual ?? null,
        descontoAntecipado: input.descontoAntecipado ?? null,
        descontoTipo: input.descontoTipo ?? null,
        prazoDesconto: input.prazoDesconto ?? null,
      },
    });

    const cobrancas: { taxa: Cobranca | null; mensalidade: Cobranca | null } = {
      taxa: null,
      mensalidade: null,
    };

    if (input.matriculaFamiliarId) {
      const family = await tx.matriculaFamiliar.findFirst({
        where: { id: input.matriculaFamiliarId, contaId: input.contaId },
        select: { id: true },
      });
      if (!family) throw new Error('AGRUPAMENTO_FAMILIAR_NAO_ENCONTRADO');
      await tx.matriculaFamiliarItem.create({
        data: {
          matriculaFamiliarId: family.id,
          matriculaId: matricula.id,
          orderIndex: input.familyOrderIndex ?? 0,
        },
      });
    }

    // Criar registros MatriculaTurma (N:N) para rastreabilidade
    if (input.turmaId) {
      await tx.matriculaTurma.create({
        data: { contaId: input.contaId, matriculaId: matricula.id, turmaId: input.turmaId },
      });
    } else if (combo?.turmas?.length) {
      await tx.matriculaTurma.createMany({
        data: combo.turmas.map((ct) => ({
          contaId: input.contaId,
          matriculaId: matricula.id,
          turmaId: ct.turmaId,
        })),
        skipDuplicates: true,
      });
    }

    await aplicarDescontosMatricula(tx, matricula.id, descontosAplicaveis, planoValor, preco);

    if (!input.taxaIsenta && input.gerarCobrancaTaxa && input.taxaMatricula > 0) {
      cobrancas.taxa = await tx.cobranca.create({
        data: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          tipo: TipoCobranca.TAXA_MATRICULA,
          descricao: 'Taxa de matrícula',
          competenciaInicio: startOfDay(new Date()),
          competenciaFim: startOfDay(new Date()),
          valor:
            input.preprovisionedBilling?.enrollmentFee?.value ?? input.taxaMatricula,
          vencimento: input.preprovisionedBilling?.enrollmentFee
            ? new Date(`${input.preprovisionedBilling.enrollmentFee.dueDate}T12:00:00.000Z`)
            : new Date(),
          formaPagamento: input.formaPagamentoTaxa ?? input.formaPagamento ?? FormaPagamento.BOLETO,
          status: input.preprovisionedBilling?.enrollmentFee
            ? mapAsaasPaymentStatusToCobranca(
                input.preprovisionedBilling.enrollmentFee.status,
                { dueDate: input.preprovisionedBilling.enrollmentFee.dueDate },
              )
            : StatusCobranca.PENDENTE,
          asaasId: input.preprovisionedBilling?.enrollmentFee?.asaasPaymentId ?? undefined,
          asaasPaymentId:
            input.preprovisionedBilling?.enrollmentFee?.asaasPaymentId ?? undefined,
          asaasStatus: input.preprovisionedBilling?.enrollmentFee?.status ?? undefined,
          asaasValue: input.preprovisionedBilling?.enrollmentFee?.value ?? undefined,
        },
      });

      const stagedFee = input.preprovisionedBilling?.enrollmentFee;
      if (stagedFee) {
        await tx.charge.create({
          data: {
            contaId: input.contaId,
            cobrancaId: cobrancas.taxa.id,
            externalReference:
              stagedFee.externalReference ??
              `enrollment-fee:${stagedFee.asaasPaymentId}`,
            status: mapAsaasPaymentStatusToCharge(stagedFee.status),
            statusUpdatedAt: new Date(),
            asaasPaymentId: stagedFee.asaasPaymentId,
            asaasStatus: stagedFee.status,
            asaasValue: stagedFee.value,
            value: stagedFee.value,
            dueDate: new Date(`${stagedFee.dueDate}T12:00:00.000Z`),
            invoiceUrl: stagedFee.invoiceUrl,
            billingType: input.preprovisionedBilling?.enrollmentFeeBillingType ?? null,
          },
        });
      }
    }

    await persistInitialEnrollmentFinancialAllocations(tx, {
      input,
      matriculaId: matricula.id,
      preco,
    });

    const contrato = await createPendingEnrollmentContract(tx, {
      contaId: input.contaId,
      matriculaId: matricula.id,
      modeloId: input.modeloId,
      actorId: input.createdById,
    });

    const staged = stagedBilling;
    if (staged) {
      const firstPayment = staged.subscription.firstPayment;
      cobrancas.mensalidade = await tx.cobranca.create({
        data: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          tipo: TipoCobranca.MENSALIDADE,
          descricao: plano?.id || combo?.id ? 'Primeira mensalidade' : 'Mensalidade',
          competenciaInicio: input.dataInicio,
          competenciaFim: input.dataFimContrato,
          valor: firstPayment.value,
          vencimento: new Date(`${firstPayment.dueDate}T12:00:00.000Z`),
          formaPagamento: input.formaPagamento ?? FormaPagamento.BOLETO,
          status: mapAsaasPaymentStatusToCobranca(firstPayment.status, {
            dueDate: firstPayment.dueDate,
          }),
          asaasId: firstPayment.asaasPaymentId,
          asaasPaymentId: firstPayment.asaasPaymentId,
          asaasStatus: firstPayment.status,
          asaasValue: firstPayment.value,
        },
      });

      const localSubscription = await tx.subscription.create({
        data: {
          contaId: input.contaId,
          contratoId: contrato.id,
          matriculaId: matricula.id,
          externalReference: staged.subscription.externalReference,
          asaasSubscriptionId: staged.subscription.asaasSubscriptionId,
          status: 'ACTIVE',
          statusUpdatedAt: new Date(),
        },
      });

      const firstCharge = await tx.charge.create({
        data: {
          contaId: input.contaId,
          cobrancaId: cobrancas.mensalidade.id,
          externalReference: `${staged.subscription.externalReference}:payment:${firstPayment.asaasPaymentId}`,
          status: mapAsaasPaymentStatusToCharge(firstPayment.status),
          statusUpdatedAt: new Date(),
          asaasPaymentId: firstPayment.asaasPaymentId,
          asaasStatus: firstPayment.status,
          asaasValue: firstPayment.value,
          value: firstPayment.value,
          dueDate: new Date(`${firstPayment.dueDate}T12:00:00.000Z`),
          invoiceUrl: firstPayment.invoiceUrl,
          billingType: staged.billingType,
          customerId: staged.customer.localCustomerId,
        },
      });

      await materializeBillingAgreement(
        {
          kind: 'INDIVIDUAL',
          contaId: input.contaId,
          subscriptionId: localSubscription.id,
          actorId: input.createdById,
          value: firstPayment.value,
          billingType: staged.billingType,
          cycle: staged.cycle,
          nextDueDate: staged.nextDueDate,
          validUntil: staged.endDate,
        },
        { tx },
      );

      await tx.matricula.updateMany({
        where: { id: matricula.id, contaId: input.contaId },
        data: {
          asaasSubscriptionId: staged.subscription.asaasSubscriptionId,
          billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
          billingProvisionError: null,
          billingProvisionAt: new Date(),
        },
      });
      await tx.familyFinancialAllocation.updateMany({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          chargeKind: 'MENSALIDADE',
        },
        data: { status: 'ACTIVE', sourceChargeId: firstCharge.id },
      });
    }

    let billingOutboxEventId: string | null = null;

    if (billingProvisionStatus === MatriculaBillingProvisionStatus.PENDENTE) {
      const outboxEventType = subscriptionTargetId
        ? 'UPDATE_EXISTING_SUBSCRIPTION_BILLING'
        : 'PROVISION_ENROLLMENT_BILLING';
      const dedupeKey = subscriptionTargetId
        ? `enrollment-subscription-update:${subscriptionTargetId}:${matricula.id}`
        : `enrollment-billing:${matricula.id}`;
      const billingOutboxEvent = await tx.matriculaBillingOutbox.create({
        data: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          aggregateType: 'MATRICULA',
          aggregateId: matricula.id,
          eventType: outboxEventType,
          dedupeKey,
          idempotencyKey: input.uiRequestId ?? dedupeKey,
          externalReference: `matricula:${matricula.id}:billing`,
          correlationId: input.uiRequestId ?? dedupeKey,
          payload: {
            matriculaId: matricula.id,
            actorUserId: input.createdById,
            subscriptionTargetId,
            billingStrategy,
          } as Prisma.InputJsonValue,
        },
      });
      billingOutboxEventId = billingOutboxEvent.id;
    }

    const committedMatricula = input.preprovisionedBilling
      ? await tx.matricula.findUniqueOrThrow({ where: { id: matricula.id } })
      : matricula;

    return {
      matricula: committedMatricula,
      cobrancas,
      descontosAplicaveis,
      preco,
      billingOutboxEventId,
      contratoId: contrato.id,
      contratoPublicToken: contrato.publicToken,
      contratoTokenExpiraEm: contrato.tokenExpiraEm,
    };
    });
  } catch (error) {
    if (
      input.uiRequestId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await findExistingMatriculaByUiRequestId({
        contaId: input.contaId,
        uiRequestId: input.uiRequestId,
      });
      if (existing) {
        return buildCriarMatriculaResultFromExisting(existing);
      }
    }
    throw error;
  }

  return {
    matricula: result.matricula,
    cobrancas: result.cobrancas,
    preco: result.preco,
    responsavelFinanceiro: null,
    primeiroVencimento,
    billingOutboxEventId: result.billingOutboxEventId,
    contratoId: result.contratoId,
    contratoPublicToken: result.contratoPublicToken,
    contratoTokenExpiraEm: result.contratoTokenExpiraEm,
  };
}

export async function buscarMatriculaPorId(input: { id: string; contaId: string }) {
  return prisma.matricula.findFirst({
    where: { id: input.id, aluno: { contaId: input.contaId } },
    include: {
      aluno: true,
      plano: true,
      turma: true,
      combo: true,
      cobrancas: { orderBy: { vencimento: 'asc' } },
      responsavelFinanceiro: true,
      matriculaFamiliar: {
        select: {
          id: true,
          standaloneEnrollmentChargeId: true,
        },
      },
      matriculaTurmas: { include: { turma: true } },
    },
  });
}

export async function atualizarStatusMatricula(input: {
  id: string;
  contaId: string;
  status: StatusMatricula;
}) {
  // Buscar matrícula atual para validar transição
  const atual = await prisma.matricula.findFirst({
    where: { id: input.id, aluno: { contaId: input.contaId } },
    select: { id: true, status: true },
  });

  if (!atual) {
    const exists = await prisma.matricula.findUnique({ where: { id: input.id } });
    if (exists) throw new Error('Matrícula não pertence à conta informada');
    throw new Error('Matrícula não encontrada');
  }

  // Validar transição de estado via máquina de estados
  const transitionResult = validateTransition(atual.status, input.status);
  if (!transitionResult.success) {
    if (transitionResult.error === 'STATUS_TERMINAL') {
      throw new Error(`Matrícula em estado "${atual.status}" não pode ser alterada (terminal).`);
    }
    throw new Error(`Transição de "${atual.status}" para "${input.status}" não é permitida.`);
  }

  await prisma.matricula.update({
    where: { id: input.id },
    data: { status: input.status },
  });

  return prisma.matricula.findFirst({ where: { id: input.id } });
}

export async function atualizarDetalhesMatricula(input: {
  id: string;
  contaId: string;
  actorId: string;
  dataInicio?: string;
  dataFimContrato?: string;
  vencimentoDia?: number;
  metadata?: Record<string, unknown>;
}) {
  const atual = await prisma.matricula.findFirst({
    where: { id: input.id, aluno: { contaId: input.contaId } },
    select: { id: true, status: true, dataInicio: true, dataFimContrato: true, vencimentoDia: true },
  });

  if (!atual) {
    const exists = await prisma.matricula.findUnique({ where: { id: input.id } });
    if (exists) throw new Error('Matrícula não pertence à conta informada');
    throw new Error('Matrícula não encontrada');
  }

  if (!canEditStructural(atual.status)) {
    throw new Error(`Matrícula em status "${atual.status}" não pode ser editada.`);
  }

  const data: Record<string, unknown> = {};
  if (input.dataInicio) {
    data.dataInicio = new Date(input.dataInicio);
  }
  if (input.dataFimContrato) {
    const nextDataInicio = input.dataInicio ? new Date(input.dataInicio) : atual.dataInicio;
    const nextDataFimContrato = new Date(input.dataFimContrato);
    const datasResult = validarDatasContrato(nextDataInicio, nextDataFimContrato, {
      permitirInicioPassado: true,
    });

    if (!datasResult.success) {
      const message =
        datasResult.error === 'DATA_FIM_ANTES_INICIO'
          ? 'Data de fim do contrato deve ser posterior à data de início.'
          : 'Data de início não pode estar no passado.';
      throw new Error(message);
    }

    data.dataFimContrato = nextDataFimContrato;
  }
  if (typeof input.vencimentoDia === 'number') {
    data.vencimentoDia = input.vencimentoDia;
  }

  if (Object.keys(data).length === 0) {
    return prisma.matricula.findFirst({ where: { id: input.id } });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.matricula.update({
      where: { id: input.id },
      data,
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: input.id,
        actorId: input.actorId,
        action: 'MATRICULA_DETAILS_EDITED',
        metadata: {
          previousDataInicio: atual.dataInicio.toISOString(),
          previousDataFimContrato: atual.dataFimContrato.toISOString(),
          previousVencimentoDia: atual.vencimentoDia,
          nextDataInicio: input.dataInicio ?? atual.dataInicio.toISOString(),
          nextDataFimContrato: input.dataFimContrato ?? atual.dataFimContrato.toISOString(),
          nextVencimentoDia: input.vencimentoDia ?? atual.vencimentoDia,
          ...(input.metadata ?? {}),
        },
      },
    });

    return updated;
  });
}

export async function editarMatricula(input: {
  matriculaId: string;
  contaId: string;
  createdById: string;
  turmaId?: string | null;
  comboId?: string | null;
  planoId?: string | null;
  motivo?: string;
  metadata?: Record<string, unknown>;
}) {
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: { id: true, status: true },
  });
  if (!matricula) throw new Error('Matrícula não encontrada');

  // Bloquear edição estrutural em status terminais
  if (!canEditStructural(matricula.status)) {
    throw new Error(`Matrícula em status "${matricula.status}" não pode ser editada.`);
  }

  return prisma.$transaction(async (tx) => {
    // MULTI-TENANT: validar contaId dentro da transação para atomicidade
    const verify = await tx.matricula.findFirst({
      where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
      select: {
        id: true,
        alunoId: true,
        turmaId: true,
        comboId: true,
        planoId: true,
        dataInicio: true,
        dataFimContrato: true,
      },
    });
    if (!verify) throw new Error('Matrícula não encontrada');

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${verify.alunoId}))
    `;

    const targetTurmaId = input.turmaId !== undefined ? input.turmaId : verify.turmaId;
    const targetComboId = input.comboId !== undefined ? input.comboId : verify.comboId;
    const turmaChanged = typeof input.turmaId !== 'undefined' && input.turmaId !== verify.turmaId;
    const comboChanged = typeof input.comboId !== 'undefined' && input.comboId !== verify.comboId;

    if (turmaChanged && targetTurmaId) {
      const turma = await tx.turma.findFirst({
        where: { id: targetTurmaId, contaId: input.contaId },
        select: {
          id: true,
          nome: true,
          capacidade: true,
          diasSemana: true,
          horaInicio: true,
          horaFim: true,
        },
      });

      if (!turma) {
        throw new Error('Turma não encontrada');
      }

      const ocupadas = await tx.matricula.count({
        where: {
          contaId: input.contaId,
          turmaId: turma.id,
          ...buildSeatOccupancyWhereClause(verify.dataInicio),
          NOT: { id: input.matriculaId },
        },
      });

      const capacidadeResult = validarCapacidade([
        {
          id: turma.id,
          nome: turma.nome,
          capacidade: turma.capacidade,
          matriculasOcupantes: ocupadas,
        },
      ]);

      if (!capacidadeResult.success) {
        throw new MatriculaConflictError(
          'TURMA_SEM_VAGAS',
          `Turma "${turma.nome}" não possui vagas disponíveis.`,
        );
      }

      const matriculasExistentes = await tx.matricula.findMany({
        where: {
          alunoId: verify.alunoId,
          ...buildSeatOccupancyWhereClause(verify.dataInicio),
          NOT: { id: input.matriculaId },
        },
        include: {
          turma: {
            select: {
              id: true,
              nome: true,
              diasSemana: true,
              horaInicio: true,
              horaFim: true,
            },
          },
        },
      });

      const turmasExistentes = matriculasExistentes
        .map((m) => m.turma)
        .filter((t): t is NonNullable<typeof t> => t !== null);

      const conflitosResult = validarConflitosHorario([turma], turmasExistentes);
      if (!conflitosResult.success) {
        throw new MatriculaConflictError(
          'CONFLITO_HORARIO',
          `Conflito de horário entre "${conflitosResult.turma1}" e "${conflitosResult.turma2}".`,
        );
      }
    }

    if (comboChanged && targetComboId) {
      const combo = await tx.combo.findFirst({
        where: { id: targetComboId, contaId: input.contaId },
        select: { id: true, vagasLimite: true },
      });

      if (!combo) {
        throw new Error('Combo não encontrado');
      }

      if (combo.vagasLimite != null) {
        const ocupadasCombo = await tx.matricula.count({
          where: {
            contaId: input.contaId,
            comboId: combo.id,
            ...buildSeatOccupancyWhereClause(verify.dataInicio),
            NOT: { id: input.matriculaId },
          },
        });

        const capacidadeComboResult = validarCapacidade([], {
          vagasLimite: combo.vagasLimite,
          matriculasOcupantes: ocupadasCombo,
        });

        if (!capacidadeComboResult.success) {
          throw new MatriculaConflictError(
            'COMBO_SEM_VAGAS',
            'Combo não possui vagas disponíveis.',
          );
        }
      }
    }

    if (turmaChanged || comboChanged) {
      await assertNoDuplicateEnrollment(tx, {
        contaId: input.contaId,
        alunoId: verify.alunoId,
        turmaId: turmaChanged ? targetTurmaId : null,
        comboId: comboChanged ? targetComboId : null,
        excludeMatriculaId: input.matriculaId,
        dataInicio: verify.dataInicio,
        dataFimContrato: verify.dataFimContrato,
      });
    }

    if (input.planoId) {
      const plano = await tx.plano.findFirst({
        where: { id: input.planoId, contaId: input.contaId },
        select: { id: true },
      });
      if (!plano) {
        throw new Error('Plano não encontrado');
      }
    }

    const updated = await tx.matricula.update({
      where: { id: input.matriculaId },
      data: {
        turmaId: input.turmaId,
        comboId: input.comboId,
        planoId: input.planoId,
      },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        actorId: input.createdById,
        action: 'MATRICULA_EDITED',
        metadata: {
          motivo: input.motivo ?? null,
          turmaId: input.turmaId ?? null,
          comboId: input.comboId ?? null,
          planoId: input.planoId ?? null,
          ...(input.metadata ?? {}),
        },
      },
    });

    return updated;
  });
}
