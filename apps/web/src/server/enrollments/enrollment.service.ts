import { logEnrollmentOperationalEvent } from '@/lib/observability/api-logger';
import { customerPayerWhere } from '@/src/server/finance/customer-payer-scope';
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
import { enqueueEnrollmentFinancialCommand, type EnrollmentFinancialCommand } from '@alusa/finance';
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
} from '@alusa/lib/services/matricula-occupancy';
import { getAcademicDateKey, getAcademicDateStartInstant, isAcademicDateInFuture } from '@alusa/shared/date-only';
import { getAcademicDateBoundsForInstant } from '@alusa/shared/date-only';
import {
  materializeBillingAgreement,
  mapAsaasPaymentStatusToCharge,
  mapAsaasPaymentStatusToCobranca,
  reconcileAcademicChargesWithAsaas,
  type AsaasBillingType,
  type Cycle,
  type StagedEnrollmentFinancialResources,
} from '@alusa/finance';
import { resolveEnrollmentFeeDueDate, resolveFirstDueDate } from '@/src/server/enrollments/recurring-billing';
import {
  resolveInitialBillingProvisionStatus,
} from '@/src/server/enrollments/billing-provision-status';
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
} from './enrollment-pricing';
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

export type MatriculaRuleErrorCode =
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'MATRICULA_STATUS_TERMINAL'
  | 'TRANSICAO_STATUS_INVALIDA'
  | 'MATRICULA_NAO_EDITAVEL'
  | 'DATA_FIM_INVALIDA'
  | 'DATA_INICIO_INVALIDA';

/**
 * Erro semântico da camada de matrícula.
 *
 * A mensagem pode ser detalhada para logs internos, mas as rotas HTTP devem
 * traduzir `code` para o envelope público estável da API. Assim, regras de
 * domínio não vazam detalhes internos nem ficam acopladas ao transporte.
 */
export class MatriculaRuleError extends Error {
  readonly code: MatriculaRuleErrorCode;

  constructor(code: MatriculaRuleErrorCode, message: string) {
    super(message);
    this.name = 'MatriculaRuleError';
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

function isP2002ForTarget(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) && target.some((value) => value === field);
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
  classRosterPeriod?: 'CURRENT' | 'FUTURE';
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
    const conta = await prisma.conta.findUnique({
      where: { id: input.contaId },
      select: { timezone: true },
    });
    const academicDay = getAcademicDateBoundsForInstant(referenceDate, conta?.timezone);
    andFilters.push(
      {
        OR: [
          { turmaId: input.turmaId },
          { matriculaTurmas: { some: { turmaId: input.turmaId } } },
        ],
      },
      { status: { notIn: [StatusMatricula.ENCERRADA, StatusMatricula.CANCELADA, StatusMatricula.RECUSADA] } },
      {
        dataInicio: input.classRosterPeriod === 'FUTURE'
          ? { gt: academicDay.end }
          : { lte: academicDay.end },
      },
      { dataFimContrato: { gte: academicDay.start } },
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
  /** Agenda a provisão recorrente para o início futuro do contrato. */
  deferSubscriptionUntil?: Date | null;
  /** A operação agregada (ex.: matrícula familiar) provisiona o billing uma única vez. */
  aggregateBillingManaged?: boolean;
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

type MatriculaCreationDb = PrismaClient | Prisma.TransactionClient;

async function loadMatriculaCreationReferences(
  db: MatriculaCreationDb,
  input: CriarMatriculaInput,
) {
  const [aluno, plano, combo, turma] = await Promise.all([
    db.aluno.findFirst({
      where: { id: input.alunoId, contaId: input.contaId },
      select: { id: true, status: true, dataNasc: true },
    }),
    input.planoId
      ? db.plano.findFirst({
          where: { id: input.planoId, contaId: input.contaId },
          select: { id: true, nome: true, valor: true, periodicidade: true },
        })
      : Promise.resolve(null),
    input.comboId
      ? db.combo.findFirst({
          where: { id: input.comboId, contaId: input.contaId },
          select: {
            id: true,
            nome: true,
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
      ? db.turma.findFirst({
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

  return { aluno, plano, combo, turma };
}

/**
 * Valida as invariantes locais antes de qualquer provisionamento remoto.
 *
 * Esta função é compartilhada pelo fluxo normal e pela saga imediata. A saga
 * ainda repete as validações dentro da transação final para proteger contra
 * mudanças concorrentes depois do preflight.
 */
export async function assertMatriculaCreationPreflight(
  input: CriarMatriculaInput,
  db: MatriculaCreationDb = prisma,
) {
  const { aluno, plano, combo, turma } = await loadMatriculaCreationReferences(db, input);
  if (!aluno) throw new Error('Aluno não encontrado');
  if (aluno.status !== 'ATIVO') {
    throw new Error('Aluno inativo não pode receber nova matrícula');
  }

  if (!input.turmaId && !input.comboId) {
    throw new Error('É necessário selecionar uma turma ou um combo.');
  }

  await assertNoDuplicateEnrollment(db, {
    contaId: input.contaId,
    alunoId: input.alunoId,
    turmaId: input.turmaId,
    turmaIds: combo?.turmas.map((item) => item.turmaId) ?? [],
    comboId: input.comboId,
    dataInicio: input.dataInicio,
    dataFimContrato: input.dataFimContrato,
  });

  const datasResult = validarDatasContrato(input.dataInicio, input.dataFimContrato, {
    permitirInicioPassado: true,
  });
  if (!datasResult.success) {
    throw new MatriculaRuleError(
      datasResult.error === 'DATA_FIM_ANTES_INICIO' ? 'DATA_FIM_INVALIDA' : 'DATA_INICIO_INVALIDA',
      datasResult.error === 'DATA_FIM_ANTES_INICIO'
        ? 'Data de fim do contrato deve ser posterior à data de início.'
        : 'Data de início não pode ser no passado.',
    );
  }

  const requiresPayer = input.criarCobranca || input.gerarCobrancaTaxa || input.pagarTaxaAgora;
  const payerResult = resolvePayer({
    alunoId: aluno.id,
    alunoDataNasc: aluno.dataNasc,
    responsavelFinanceiroId: input.responsavelFinanceiroId,
  });
  if (requiresPayer && !payerResult.success) {
    throw new Error('Responsável financeiro é obrigatório para alunos menores de 18 anos.');
  }

  const targetTurmas = turma ? [turma] : combo?.turmas.map((item) => item.turma) ?? [];
  await assertTargetTurmasAvailable(db, {
    contaId: input.contaId,
    alunoId: input.alunoId,
    targetTurmas,
    dataInicio: input.dataInicio,
    dataFimContrato: input.dataFimContrato,
  });

  if (combo?.vagasLimite != null) {
    const comboOcupadas = await db.matricula.count({
      where: {
        contaId: input.contaId,
        comboId: combo.id,
        ...buildSeatOccupancyOverlapWhereClause(input.dataInicio, input.dataFimContrato),
      },
    });
    const capResult = validarCapacidade([], {
      vagasLimite: combo.vagasLimite,
      matriculasOcupantes: comboOcupadas,
    });
    if (!capResult.success) {
      throw new MatriculaConflictError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis.');
    }
  }

  return {
    aluno,
    plano,
    combo,
    turma,
    targetTurmas,
    payer: payerResult.success ? payerResult.payer : null,
  };
}

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

  const { plano, combo, targetTurmas } =
    await assertMatriculaCreationPreflight(input);

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

    const capacityLockIds = [
      ...targetTurmas.map((item) => `turma:${item.id}`),
      ...(combo ? [`combo:${combo.id}`] : []),
    ].sort();
    for (const lockId of capacityLockIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${lockId}))`;
    }

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
      select: { matriculaActivationPolicy: true, timezone: true },
    });
    const policy = conta?.matriculaActivationPolicy ?? 'IMMEDIATE';
    const contractStartsInFuture = isAcademicDateInFuture(
      input.dataInicio,
      new Date(),
      conta?.timezone ?? undefined,
    );

    const requiresDeferredBillingConfirmation =
      (input.criarCobranca || input.requiresFinancialProvisioning === true) &&
      !input.preprovisionedBilling;

    let statusInicial: StatusMatricula;
    if (contractStartsInFuture) {
      // Future enrollments remain outside current active-student and seat counts
      // until the scheduled outbox reaches the academic contract start.
      statusInicial = StatusMatricula.AGUARDANDO_CONFIRMACAO;
    } else if (requiresDeferredBillingConfirmation) {
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
            ...customerPayerWhere(
              input.contaId,
              input.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO',
              input.responsavelFinanceiroId ?? input.alunoId,
            ),
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
      const obligationPayerType = input.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
      const obligationPayerId = input.responsavelFinanceiroId ?? matricula.alunoId;
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
            : resolveEnrollmentFeeDueDate(input.dataInicio),
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
            payerType: obligationPayerType,
            payerId: obligationPayerId,
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
      const obligationPayerType = input.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
      const obligationPayerId = input.responsavelFinanceiroId ?? matricula.alunoId;
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
          payerType: obligationPayerType,
          payerId: obligationPayerId,
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

    if (
      (billingProvisionStatus === MatriculaBillingProvisionStatus.PENDENTE || Boolean(input.deferSubscriptionUntil)) &&
      input.aggregateBillingManaged !== true
    ) {
      const outboxEventType = subscriptionTargetId
        ? 'UPDATE_EXISTING_SUBSCRIPTION_BILLING'
        : 'PROVISION_ENROLLMENT_BILLING';
      const dedupeKey = subscriptionTargetId
        ? `enrollment-subscription-update:${subscriptionTargetId}:${matricula.id}`
        : `enrollment-billing:${matricula.id}`;
      const deferSubscription = Boolean(input.deferSubscriptionUntil);
      const hasEnrollmentFee = !input.taxaIsenta && input.gerarCobrancaTaxa && input.taxaMatricula > 0;
      const billingOutboxEvent = await tx.matriculaBillingOutbox.create({
        data: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          aggregateType: 'MATRICULA',
          aggregateId: matricula.id,
          eventType: deferSubscription && hasEnrollmentFee ? 'PROVISION_ENROLLMENT_FEE' : outboxEventType,
          ...(deferSubscription && !hasEnrollmentFee ? { availableAt: input.deferSubscriptionUntil! } : {}),
          dedupeKey: deferSubscription && hasEnrollmentFee ? `enrollment-fee:${matricula.id}` : dedupeKey,
          idempotencyKey: deferSubscription && hasEnrollmentFee ? `enrollment-fee:${matricula.id}` : input.uiRequestId ?? dedupeKey,
          externalReference: `matricula:${matricula.id}:billing`,
          correlationId: input.uiRequestId ?? dedupeKey,
          payload: {
            matriculaId: matricula.id,
            actorUserId: input.createdById,
            subscriptionTargetId,
            billingStrategy,
            ...(input.criarCobranca !== undefined ? { createRecurringBilling: input.criarCobranca === true } : {}),
            ...(deferSubscription && hasEnrollmentFee ? { billingPhase: 'ENROLLMENT_FEE' } : {}),
            ...(deferSubscription && !hasEnrollmentFee ? { billingPhase: 'SUBSCRIPTION_ONLY' } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      billingOutboxEventId = billingOutboxEvent.id;

      if (deferSubscription && hasEnrollmentFee) {
        const scheduledDedupeKey = dedupeKey;
        await tx.matriculaBillingOutbox.create({
          data: {
            contaId: input.contaId,
            matriculaId: matricula.id,
            aggregateType: 'MATRICULA',
            aggregateId: matricula.id,
            eventType: outboxEventType,
            availableAt: input.deferSubscriptionUntil!,
            dedupeKey: scheduledDedupeKey,
            idempotencyKey: input.uiRequestId ?? scheduledDedupeKey,
            externalReference: `matricula:${matricula.id}:billing`,
            correlationId: input.uiRequestId ?? scheduledDedupeKey,
            payload: {
              matriculaId: matricula.id,
              actorUserId: input.createdById,
              subscriptionTargetId,
              billingStrategy,
              billingPhase: 'SUBSCRIPTION_ONLY',
              createRecurringBilling: input.criarCobranca === true,
            } as Prisma.InputJsonValue,
          },
        });
      }
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
      isP2002ForTarget(error, 'uiRequestId')
    ) {
      const existing = await findExistingMatriculaByUiRequestId({
        contaId: input.contaId,
        uiRequestId: input.uiRequestId,
      });
      if (existing) {
        return buildCriarMatriculaResultFromExisting(existing);
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logEnrollmentOperationalEvent('api.enrollment.operation.unique_conflict', error);
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
    select: { id: true, status: true, cancelledAt: true },
  });

  if (!atual) {
    throw new MatriculaRuleError('MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
  }

  // Validar transição de estado via máquina de estados
  const transitionResult = validateTransition(atual.status, input.status);
  if (!transitionResult.success) {
    if (transitionResult.error === 'STATUS_TERMINAL') {
      throw new MatriculaRuleError(
        'MATRICULA_STATUS_TERMINAL',
        `Matrícula em estado "${atual.status}" não pode ser alterada (terminal).`,
      );
    }
    throw new MatriculaRuleError(
      'TRANSICAO_STATUS_INVALIDA',
      `Transição de "${atual.status}" para "${input.status}" não é permitida.`,
    );
  }

  await prisma.matricula.update({
    where: { id: input.id },
    data: {
      status: input.status,
      ...(input.status === 'CANCELADA'
        ? { cancelledAt: atual.cancelledAt ?? new Date() }
        : {}),
    },
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
  financialCommand?: Omit<EnrollmentFinancialCommand, 'version' | 'commandId' | 'actorId' | 'matriculaId'>;
}) {
  const atual = await prisma.matricula.findFirst({
    where: { id: input.id, aluno: { contaId: input.contaId } },
    select: { id: true, status: true, dataInicio: true, dataFimContrato: true, vencimentoDia: true, matriculaFamiliarId: true },
  });

  if (!atual) {
    throw new MatriculaRuleError('MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
  }

  if (!canEditStructural(atual.status)) {
    throw new MatriculaRuleError(
      'MATRICULA_NAO_EDITAVEL',
      `Matrícula em status "${atual.status}" não pode ser editada.`,
    );
  }

  const data: Record<string, unknown> = {};
  const nextDataInicio = input.dataInicio ? new Date(input.dataInicio) : atual.dataInicio;
  const nextDataFimContrato = input.dataFimContrato ? new Date(input.dataFimContrato) : atual.dataFimContrato;
  const datasResult = validarDatasContrato(nextDataInicio, nextDataFimContrato, {
    permitirInicioPassado: true,
  });
  if (!datasResult.success) {
    throw new MatriculaRuleError(
      datasResult.error === 'DATA_FIM_ANTES_INICIO' ? 'DATA_FIM_INVALIDA' : 'DATA_INICIO_INVALIDA',
      datasResult.error === 'DATA_FIM_ANTES_INICIO'
        ? 'Data de fim do contrato deve ser posterior à data de início.'
        : 'Data de início não pode estar no passado.',
    );
  }
  if (input.dataInicio) data.dataInicio = nextDataInicio;
  if (input.dataFimContrato) data.dataFimContrato = nextDataFimContrato;
  if (typeof input.vencimentoDia === 'number') {
    data.vencimentoDia = input.vencimentoDia;
  }

  if (Object.keys(data).length === 0) {
    return prisma.matricula.findFirst({ where: { id: input.id } });
  }

  return prisma.$transaction(async (tx) => {
    if (input.dataInicio) {
      const [activeIndividualEvent, activeFamilyEvent] = await Promise.all([
        tx.matriculaBillingOutbox.findFirst({
          where: {
            contaId: input.contaId,
            matriculaId: input.id,
            eventType: { not: 'PROVISION_ENROLLMENT_FEE' },
            status: { in: ['PROCESSING', 'REQUIRES_RECONCILIATION'] },
          },
          select: { id: true },
        }),
        atual.matriculaFamiliarId
          ? tx.familyBillingOutbox.findFirst({
              where: {
                contaId: input.contaId,
                aggregateId: atual.matriculaFamiliarId,
                eventType: { startsWith: 'FUTURE_FAMILY_RECURRING:' },
                status: { in: ['PROCESSING', 'REQUIRES_RECONCILIATION'] },
              },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);
      if (activeIndividualEvent || activeFamilyEvent) {
        throw new MatriculaRuleError('MATRICULA_NAO_EDITAVEL', 'A vigência não pode ser alterada enquanto um evento financeiro estiver em processamento ou reconciliação.');
      }
    }
    const individualEvents = input.dataInicio
      ? await tx.matriculaBillingOutbox.findMany({
          where: {
            contaId: input.contaId,
            matriculaId: input.id,
            eventType: { not: 'PROVISION_ENROLLMENT_FEE' },
            status: { in: ['PENDING', 'FAILED'] },
          },
          select: { id: true, status: true },
        })
      : [];
    const familyEvents = input.dataInicio && atual.matriculaFamiliarId
      ? await tx.familyBillingOutbox.findMany({
          where: {
            contaId: input.contaId,
            aggregateId: atual.matriculaFamiliarId,
            eventType: { startsWith: 'FUTURE_FAMILY_RECURRING:' },
            status: { in: ['PENDING', 'FAILED'] },
          },
          select: { id: true, status: true, payload: true },
        })
      : [];
    for (const event of individualEvents) {
      const claim = await tx.matriculaBillingOutbox.updateMany({
        where: { id: event.id, contaId: input.contaId, status: event.status },
        data: { status: 'PROCESSING' },
      });
      if (claim.count !== 1) {
        throw new MatriculaRuleError('MATRICULA_NAO_EDITAVEL', 'O evento financeiro já foi reivindicado pelo worker; tente editar a vigência novamente após a reconciliação.');
      }
    }
    for (const event of familyEvents) {
      const claim = await tx.familyBillingOutbox.updateMany({
        where: { id: event.id, contaId: input.contaId, status: event.status },
        data: { status: 'PROCESSING' },
      });
      if (claim.count !== 1) {
        throw new MatriculaRuleError('MATRICULA_NAO_EDITAVEL', 'O evento financeiro familiar já foi reivindicado pelo worker; tente editar a vigência novamente após a reconciliação.');
      }
    }
    const familyMembers = input.dataInicio && atual.matriculaFamiliarId
      ? await tx.matricula.findMany({
          where: { contaId: input.contaId, matriculaFamiliarId: atual.matriculaFamiliarId },
          select: { id: true, dataInicio: true, dataFimContrato: true },
        })
      : [];
    if (familyMembers.some((member) => member.dataFimContrato < nextDataInicio)) {
      throw new MatriculaRuleError(
        'DATA_INICIO_INVALIDA',
        'A nova data de início ultrapassa o fim do contrato de um ou mais membros da família.',
      );
    }
    const updated = await tx.matricula.update({
      where: { id: input.id },
      data,
    });

    if (input.dataInicio && atual.matriculaFamiliarId && familyMembers.length > 1) {
      await tx.matricula.updateMany({
        where: {
          contaId: input.contaId,
          matriculaFamiliarId: atual.matriculaFamiliarId,
          id: { not: input.id },
        },
        data: { dataInicio: nextDataInicio },
      });
      await tx.matriculaLog.createMany({
        data: familyMembers
          .filter((member) => member.id !== input.id)
          .map((member) => ({
            matriculaId: member.id,
            actorId: input.actorId,
            action: 'MATRICULA_DETAILS_EDITED',
            metadata: {
              previousDataInicio: member.dataInicio.toISOString(),
              nextDataInicio: nextDataInicio.toISOString(),
              familyStartDateSynchronized: true,
            } as Prisma.InputJsonValue,
          })),
      });
    }

    if (input.dataInicio) {
      const account = await tx.conta.findUnique({ where: { id: input.contaId }, select: { timezone: true } });
      const startKey = getAcademicDateKey(nextDataInicio);
      if (startKey) {
        const availableAt = getAcademicDateStartInstant(startKey, account?.timezone ?? undefined);
        for (const event of individualEvents) {
          await tx.matriculaBillingOutbox.updateMany({
            where: { id: event.id, contaId: input.contaId, status: 'PROCESSING' },
            data: {
              status: event.status,
              availableAt,
            },
          });
        }
        for (const event of familyEvents) {
          const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : {};
          await tx.familyBillingOutbox.updateMany({
            where: { id: event.id, contaId: input.contaId, status: 'PROCESSING' },
            data: {
              status: event.status,
              availableAt,
              payload: { ...payload, scheduledEffectiveAt: availableAt.toISOString() } as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

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

    let financialCommandEventId: string | null = null;
    if (input.financialCommand) {
      const command = await enqueueEnrollmentFinancialCommand(tx, {
        contaId: input.contaId,
        actorId: input.actorId,
        dedupeKey: `enrollment-financial-dates:${input.id}:${JSON.stringify(input.financialCommand)}`,
        command: { ...input.financialCommand, matriculaId: input.id },
      });
      financialCommandEventId = command.id;
    }

    return Object.assign(updated, { financialCommandEventId });
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
  financialCommand?: Omit<EnrollmentFinancialCommand, 'version' | 'commandId' | 'matriculaId' | 'actorId'>;
}) {
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: { id: true, status: true },
  });
  if (!matricula) throw new MatriculaRuleError('MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');

  // Bloquear edição estrutural em status terminais
  if (!canEditStructural(matricula.status)) {
    throw new MatriculaRuleError(
      'MATRICULA_NAO_EDITAVEL',
      `Matrícula em status "${matricula.status}" não pode ser editada.`,
    );
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
    if (!verify) throw new MatriculaRuleError('MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${verify.alunoId}))
    `;

    const targetTurmaId = input.turmaId !== undefined ? input.turmaId : verify.turmaId;
    const targetComboId = input.comboId !== undefined ? input.comboId : verify.comboId;
    const turmaChanged = typeof input.turmaId !== 'undefined' && input.turmaId !== verify.turmaId;
    const comboChanged = typeof input.comboId !== 'undefined' && input.comboId !== verify.comboId;

    // Serialize capacity checks by tenant + class/combo, including N:N class
    // memberships. Sorted lock acquisition keeps multi-class combos deadlock-safe.
    const [currentMemberships, requestedCombo] = await Promise.all([
      tx.matriculaTurma.findMany({
        where: { contaId: input.contaId, matriculaId: input.matriculaId },
        select: { turmaId: true },
      }),
      targetComboId
        ? tx.combo.findFirst({
            where: { id: targetComboId, contaId: input.contaId },
            select: { turmas: { select: { turmaId: true } } },
          })
        : Promise.resolve(null),
    ]);
    const lockedClassIds = Array.from(new Set([
      ...(targetTurmaId ? [targetTurmaId] : []),
      ...(requestedCombo?.turmas.map((item) => item.turmaId) ?? []),
      ...currentMemberships.map((item) => item.turmaId),
    ])).sort();
    const capacityLockIds = [
      ...lockedClassIds.map((turmaId) => `turma:${turmaId}`),
      ...(targetComboId ? [`combo:${targetComboId}`] : []),
    ].sort();
    for (const lockId of capacityLockIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${lockId}))`;
    }

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
          OR: [
            { turmaId: turma.id },
            { matriculaTurmas: { some: { turmaId: turma.id } } },
          ],
          ...buildSeatOccupancyOverlapWhereClause(verify.dataInicio, verify.dataFimContrato),
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
          contaId: input.contaId,
          alunoId: verify.alunoId,
          ...buildSeatOccupancyOverlapWhereClause(verify.dataInicio, verify.dataFimContrato),
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
          matriculaTurmas: {
            include: { turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } } },
          },
        },
      });

      const turmasExistentes = Array.from(new Map(
        matriculasExistentes.flatMap((m) => [m.turma, ...m.matriculaTurmas.map((item) => item.turma)])
          .filter((t): t is NonNullable<typeof t> => t !== null)
          .map((t) => [t.id, t]),
      ).values());

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
            ...buildSeatOccupancyOverlapWhereClause(verify.dataInicio, verify.dataFimContrato),
            comboId: combo.id,
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

      const comboTurmas = await tx.turma.findMany({
        where: { contaId: input.contaId, id: { in: requestedCombo?.turmas.map((item) => item.turmaId) ?? [] } },
        select: { id: true, nome: true, capacidade: true, diasSemana: true, horaInicio: true, horaFim: true },
      });
      for (const turma of comboTurmas) {
        const occupied = await tx.matricula.count({
          where: { contaId: input.contaId, OR: [{ turmaId: turma.id }, { matriculaTurmas: { some: { turmaId: turma.id } } }], ...buildSeatOccupancyOverlapWhereClause(verify.dataInicio, verify.dataFimContrato), NOT: { id: input.matriculaId } },
        });
        if (!validarCapacidade([{ id: turma.id, nome: turma.nome, capacidade: turma.capacidade, matriculasOcupantes: occupied }]).success) {
          throw new MatriculaConflictError('TURMA_SEM_VAGAS', `Turma "${turma.nome}" não possui vagas disponíveis.`);
        }
      }
      const otherEnrollments = await tx.matricula.findMany({
        where: { contaId: input.contaId, alunoId: verify.alunoId, ...buildSeatOccupancyOverlapWhereClause(verify.dataInicio, verify.dataFimContrato), NOT: { id: input.matriculaId } },
        include: { turma: true, matriculaTurmas: { include: { turma: true } } },
      });
      const otherTurmas = Array.from(new Map(otherEnrollments.flatMap((item) => [item.turma, ...item.matriculaTurmas.map((membership) => membership.turma)]).filter((item): item is NonNullable<typeof item> => item !== null).map((item) => [item.id, item])).values());
      const comboSchedule = validarConflitosHorario(comboTurmas, otherTurmas);
      if (!comboSchedule.success) throw new MatriculaConflictError('CONFLITO_HORARIO', `Conflito de horário entre "${comboSchedule.turma1}" e "${comboSchedule.turma2}".`);
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

    let financialCommandEventId: string | null = null;
    if (input.financialCommand) {
      const commandEvent = await enqueueEnrollmentFinancialCommand(tx, {
        contaId: input.contaId,
        actorId: input.createdById,
        dedupeKey: `enrollment-financial-command:${input.matriculaId}:${input.financialCommand.targetSubscriptionId}:${JSON.stringify(input.financialCommand)}`,
        command: { ...input.financialCommand, matriculaId: input.matriculaId },
      });
      financialCommandEventId = commandEvent.id;
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

    if (turmaChanged || comboChanged) {
      const desiredTurmaIds = targetComboId
        ? (requestedCombo?.turmas.map((item) => item.turmaId) ?? [])
        : targetTurmaId ? [targetTurmaId] : [];
      await tx.matriculaTurma.deleteMany({ where: { contaId: input.contaId, matriculaId: input.matriculaId } });
      if (desiredTurmaIds.length > 0) {
        await tx.matriculaTurma.createMany({
          data: Array.from(new Set(desiredTurmaIds)).map((turmaId) => ({ contaId: input.contaId, matriculaId: input.matriculaId, turmaId })),
          skipDuplicates: true,
        });
      }
    }

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

    return Object.assign(updated, { financialCommandEventId });
  });
}
