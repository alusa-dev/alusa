import {
  FormaPagamento,
  Prisma,
  StatusCobranca,
  StatusFinanceiro,
  StatusMatricula,
  StatusTaxaMatricula,
  TipoCobranca,
} from '@prisma/client';
import type { Cobranca } from '@prisma/client';
import { prisma } from '@/src/prisma';
import { resolvePayer, validarCapacidade, validarConflitosHorario, validarDatasContrato, validateTransition, canEditStructural } from '@alusa/domain';
import { buildSeatOccupancyWhereClause } from '@alusa/lib';

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

export type DescontoInput = {
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  cumulativo?: boolean;
};

export type CalcularPrecoInput = {
  planoValor: number;
  taxaMatricula?: number;
  descontos?: DescontoInput[];
};

export type CalcularPrecoOutput = {
  plano: number;
  planoLiquido: number;
  taxa: number;
  descontosAplicados: number[];
  total: number;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularPrecoMatricula(input: CalcularPrecoInput): CalcularPrecoOutput {
  const plano = Math.max(0, Number(input.planoValor || 0));
  const taxa = Math.max(0, Number(input.taxaMatricula || 0));
  const descontos = input.descontos ?? [];

  const valores = descontos.map((d) => {
    const v = Number(d.valor || 0);
    if (d.tipo === 'PERCENTUAL') return round2(plano * (v / 100));
    return round2(v);
  });

  const hasCumulativo = descontos.some((d) => d.cumulativo);

  const descontosAplicados = hasCumulativo
    ? valores
    : valores.length
      ? [Math.max(...valores)]
      : [];

  const totalDescontos = round2(descontosAplicados.reduce((acc, n) => acc + n, 0));
  const planoLiquido = Math.max(0, round2(plano - totalDescontos));
  const total = round2(planoLiquido + taxa);

  return {
    plano: round2(plano),
    planoLiquido,
    taxa: round2(taxa),
    descontosAplicados,
    total,
  };
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function resolveFirstDueDate(dataInicio: Date, vencimentoDia: number) {
  const base = new Date(dataInicio);
  const day = Math.min(28, Math.max(1, vencimentoDia));
  const due = new Date(base.getFullYear(), base.getMonth(), day);
  if (due < startOfDay(base)) {
    return new Date(base.getFullYear(), base.getMonth() + 1, day);
  }
  return due;
}

type MatriculaPersistence = {
  matricula: {
    findFirst: (_args: Prisma.MatriculaFindFirstArgs) => Promise<{ id: string } | null>;
  };
};

async function assertNoDuplicateEnrollment(
  db: MatriculaPersistence,
  params: {
    alunoId: string;
    turmaId?: string | null;
    comboId?: string | null;
    excludeMatriculaId?: string;
  },
) {
  if (params.turmaId) {
    const existingByTurma = await db.matricula.findFirst({
      where: {
        alunoId: params.alunoId,
        turmaId: params.turmaId,
        ...buildSeatOccupancyWhereClause(),
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
        alunoId: params.alunoId,
        comboId: params.comboId,
        ...buildSeatOccupancyWhereClause(),
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
    ...(input.turmaId ? { turmaId: input.turmaId } : {}),
    ...(input.comboId !== undefined ? { comboId: input.comboId } : {}),
    ...(input.status?.length ? { status: { in: input.status } } : {}),
    ...(input.search?.trim()
      ? {
        OR: [
          { aluno: { nome: { contains: input.search.trim(), mode: 'insensitive' as const } } },
          { aluno: { cpf: { contains: input.search.trim() } } },
        ],
      }
      : {}),
  };

  if (input.excludeStatus?.length) {
    if (where.status) {
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, { status: { notIn: input.excludeStatus } }];
    } else {
      where.status = { notIn: input.excludeStatus };
    }
  }

  const [total, data] = await Promise.all([
    prisma.matricula.count({ where }),
    prisma.matricula.findMany({
      where,
      orderBy: { dataInicio: 'desc' },
      skip,
      take: pageSize,
      include: {
        aluno: { select: { id: true, nome: true, cpf: true } },
        plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
        turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
        matriculaTurmas: {
          include: {
            turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
          },
        },
        combo: { select: { id: true, nome: true, periodicidade: true, valor: true } },
        cobrancas: { orderBy: { vencimento: 'asc' } },
        responsavelFinanceiro: { select: { id: true, nome: true, cpf: true, email: true, telefone: true } },
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

  const normalized = data.map((item) => ({
    ...item,
    turmas: item.matriculaTurmas.map((mt) => mt.turma).filter(Boolean),
  }));

  return { data: normalized, total, page, pageSize };
}

export type CriarMatriculaInput = {
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
  formaPagamento?: FormaPagamento;
  formaPagamentoTaxa?: FormaPagamento;
  createdById: string;
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

export async function criarMatricula(input: CriarMatriculaInput) {
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
    alunoId: input.alunoId,
    turmaId: input.turmaId,
    comboId: input.comboId,
  });

  // Validar datas de contrato
  const datasResult = validarDatasContrato(input.dataInicio, input.dataFimContrato, { permitirInicioPassado: true });
  if (!datasResult.success) {
    throw new Error(
      datasResult.error === 'DATA_FIM_ANTES_INICIO'
        ? 'Data de fim do contrato deve ser posterior à data de início.'
        : 'Data de início não pode ser no passado.'
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
        select: { id: true, valor: true, periodicidade: true, vagasLimite: true },
      })
      : Promise.resolve(null),
    input.turmaId
      ? prisma.turma.findFirst({
        where: { id: input.turmaId, contaId: input.contaId },
        select: { id: true, nome: true, capacidade: true, diasSemana: true, horaInicio: true, horaFim: true },
      })
      : Promise.resolve(null),
  ]);

  // Validar capacidade de vagas
  if (turma) {
    const ocupadas = await prisma.matricula.count({
      where: { turmaId: turma.id, ...buildSeatOccupancyWhereClause() },
    });
    const capResult = validarCapacidade([{ id: turma.id, nome: turma.nome, capacidade: turma.capacidade, matriculasOcupantes: ocupadas }]);
    if (!capResult.success) {
      throw new MatriculaConflictError(
        'TURMA_SEM_VAGAS',
        `Turma "${turma.nome}" não possui vagas disponíveis.`,
      );
    }
  }

  if (combo) {
    if ((combo as { vagasLimite?: number | null }).vagasLimite != null) {
      const comboOcupadas = await prisma.matricula.count({
        where: { comboId: combo.id, ...buildSeatOccupancyWhereClause() },
      });
      const capResult = validarCapacidade([], { vagasLimite: (combo as { vagasLimite?: number | null }).vagasLimite, matriculasOcupantes: comboOcupadas });
      if (!capResult.success) {
        throw new MatriculaConflictError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis.');
      }
    }
  }

  // Validar conflitos de horário
  if (turma) {
    const matriculasExistentes = await prisma.matricula.findMany({
      where: { alunoId: input.alunoId, ...buildSeatOccupancyWhereClause() },
      include: {
        turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
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

  const planoValor = combo ? Number(combo.valor) : plano ? Number(plano.valor) : 0;

  const primeiroVencimento = resolveFirstDueDate(input.dataInicio, input.vencimentoDia);

  const result = await prisma.$transaction(async (tx) => {
    await assertNoDuplicateEnrollment(tx, {
      alunoId: input.alunoId,
      turmaId: input.turmaId,
      comboId: input.comboId,
    });

    // Determinar status inicial baseado na política da conta
    const conta = await tx.conta.findUnique({
      where: { id: input.contaId },
      select: { matriculaActivationPolicy: true },
    });
    const policy = conta?.matriculaActivationPolicy ?? 'IMMEDIATE';

    let statusInicial: StatusMatricula;
    if (policy === 'REQUIRES_PAYMENT' && !input.taxaIsenta && input.taxaMatricula > 0) {
      statusInicial = StatusMatricula.PENDENTE_TAXA;
    } else {
      statusInicial = StatusMatricula.ATIVA;
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

    const matricula = await tx.matricula.create({
      data: {
        alunoId: input.alunoId,
        responsavelFinanceiroId: input.responsavelFinanceiroId ?? undefined,
        turmaId: input.turmaId ?? undefined,
        planoId: input.planoId ?? undefined,
        comboId: input.comboId ?? undefined,
        dataInicio: input.dataInicio,
        dataFimContrato: input.dataFimContrato,
        taxaMatricula: input.taxaMatricula,
        taxaIsenta: input.taxaIsenta,
        taxaJustificativa: input.taxaJustificativa ?? undefined,
        formaPagamento: input.formaPagamento ?? FormaPagamento.BOLETO,
        vencimentoDia: input.vencimentoDia,
        status: statusInicial,
        taxaStatus: input.taxaIsenta ? StatusTaxaMatricula.ISENTO : StatusTaxaMatricula.PENDENTE,
        statusFinanceiro: input.taxaIsenta ? StatusFinanceiro.ADIMPLENTE : StatusFinanceiro.PENDENTE_TAXA,
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

    // Criar registros MatriculaTurma (N:N) para rastreabilidade
    if (input.turmaId) {
      await tx.matriculaTurma.create({
        data: { matriculaId: matricula.id, turmaId: input.turmaId },
      });
    }

    await aplicarDescontosMatricula(tx, matricula.id, descontosAplicaveis, planoValor, preco);

    if (!input.taxaIsenta && input.gerarCobrancaTaxa && input.taxaMatricula > 0) {
      cobrancas.taxa = await tx.cobranca.create({
        data: {
          matriculaId: matricula.id,
          tipo: TipoCobranca.TAXA_MATRICULA,
          descricao: 'Taxa de matrícula',
          competenciaInicio: startOfDay(new Date()),
          competenciaFim: startOfDay(new Date()),
          valor: input.taxaMatricula,
          vencimento: new Date(),
          formaPagamento: input.formaPagamentoTaxa ?? input.formaPagamento ?? FormaPagamento.BOLETO,
          status: StatusCobranca.PENDENTE,
        },
      });
    }

    return {
      matricula,
      cobrancas,
      descontosAplicaveis,
      preco,
    };
  });

  return {
    matricula: result.matricula,
    cobrancas: result.cobrancas,
    preco: result.preco,
    responsavelFinanceiro: null,
    primeiroVencimento,
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
  vencimentoDia?: number;
  metadata?: Record<string, unknown>;
}) {
  const atual = await prisma.matricula.findFirst({
    where: { id: input.id, aluno: { contaId: input.contaId } },
    select: { id: true, status: true, dataInicio: true, vencimentoDia: true },
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
          previousVencimentoDia: atual.vencimentoDia,
          nextDataInicio: input.dataInicio ?? atual.dataInicio.toISOString(),
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
  turmaId?: string;
  comboId?: string;
  planoId?: string;
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
      },
    });
    if (!verify) throw new Error('Matrícula não encontrada');

    const targetTurmaId = input.turmaId ?? verify.turmaId ?? undefined;
    const targetComboId = input.comboId ?? verify.comboId ?? undefined;
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
          turmaId: turma.id,
          ...buildSeatOccupancyWhereClause(),
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
          ...buildSeatOccupancyWhereClause(),
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
            comboId: combo.id,
            ...buildSeatOccupancyWhereClause(),
            NOT: { id: input.matriculaId },
          },
        });

        const capacidadeComboResult = validarCapacidade([], {
          vagasLimite: combo.vagasLimite,
          matriculasOcupantes: ocupadasCombo,
        });

        if (!capacidadeComboResult.success) {
          throw new MatriculaConflictError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis.');
        }
      }
    }

    if (turmaChanged || comboChanged) {
      await assertNoDuplicateEnrollment(tx, {
        alunoId: verify.alunoId,
        turmaId: turmaChanged ? targetTurmaId : null,
        comboId: comboChanged ? targetComboId : null,
        excludeMatriculaId: input.matriculaId,
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
