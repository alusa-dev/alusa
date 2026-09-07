import { StatusContrato, StatusMatricula, type Prisma } from '@prisma/client';
import { prisma } from '@/src/prisma';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  buildFinancialSnapshot,
  evaluateCanonicalRematriculaDecision,
} from './rematricula-financial-policy.service';
import {
  compareEnrollmentRecency,
  type EnrollmentChainRow,
  resolveEnrollmentRootId,
} from './rematricula-chain';
import {
  addAcademicDays,
  getAcademicDateBoundsForStoredDate,
  getAcademicDateDifference,
  getCurrentAcademicDateKey,
} from '@alusa/lib/date-only';

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type RematriculaElegivelItem = {
  id: string;
  status: StatusMatricula;
  statusContrato: StatusContrato;
  dataInicio: Date;
  dataFimContrato: Date;
  diasRestantes: number;
  contratoExpirado: boolean;
  podeRenovar: boolean;
  eligibilityStatus: 'ELEGIVEL' | 'NAO_ELEGIVEL';
  matriculaFamiliarId: string | null;
  aluno: {
    id: string;
    nome: string;
    cpf: string | null;
    foto?: string | null;
  };
  responsavelFinanceiro: {
    id: string;
    nome: string;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
    foto?: string | null;
  } | null;
  plano: { id: string; nome: string } | null;
  turma: {
    id: string;
    nome: string;
    diasSemana: string[];
    horaInicio: string;
    horaFim: string;
  } | null;
  combo: { id: string; nome: string } | null;
  financeiro: {
    pendencias: number;
    cobrancasEmAberto: number;
    cobrancasAtrasadas: number;
    financialStatus: 'REGULAR' | 'PENDENTE' | 'ATRASADO' | 'MULTIPLAS_COBRANCAS_EM_ABERTO' | 'DESCONHECIDO';
    rematriculaActionStatus: 'LIBERADA' | 'LIBERADA_COM_AVISO' | 'REQUER_OVERRIDE' | 'BLOQUEADA';
    blockReason:
      | 'SEM_BLOQUEIO'
      | 'COBRANCA_EM_ABERTO'
      | 'COBRANCA_ATRASADA'
      | 'MULTIPLAS_COBRANCAS'
      | 'AGUARDANDO_RECONCILIACAO'
      | 'OUTRO';
    actionMessage: string;
    canCurrentUserOverride: boolean;
    requiresOverrideReason: boolean;
    shouldBlockNewFinancialCycle: boolean;
    formaPagamento: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO' | null;
    formaPagamentoTaxa: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | 'INDEFINIDO' | null;
    vencimentoDia: number | null;
    taxaMatricula: number | null;
    taxaIsenta: boolean;
    taxaJustificativa: string | null;
    multaPercentual: number | null;
    jurosMensal: number | null;
    descontoAntecipado: number | null;
    prazoDesconto: number | null;
    diasTolerancia: number | null;
    descontos: Array<{ id: string; nome: string }>;
  };
};

export async function listarRematriculasElegiveis(input: {
  contaId: string;
  diasAntecedencia?: number;
  referencia?: Date;
  statusContrato?: StatusContrato;
  targetPeriodId?: string;
  search?: string;
  currentUserRole?: string | null;
}): Promise<{ referencia: Date; ate: Date; total: number; itens: RematriculaElegivelItem[] }> {
  const diasAntecedencia = Math.max(0, Math.min(365, input.diasAntecedencia ?? 60));
  const referencia = input.referencia ?? new Date();
  const conta = await prisma.conta?.findUnique({
    where: { id: input.contaId },
    select: { timezone: true },
  });
  const timeZone = conta?.timezone;
  const limiteAcademicDate = getAcademicDateBoundsForStoredDate(
    addAcademicDays(getCurrentAcademicDateKey(referencia, timeZone), diasAntecedencia),
  );
  const limite = limiteAcademicDate.end;

  const matriculas = await prisma.matricula.findMany({
    where: {
      contaId: input.contaId,
      aluno: { contaId: input.contaId },
      status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA, StatusMatricula.AGUARDANDO_CONFIRMACAO] },
      dataFimContrato: { lte: limite },
      ...(input.statusContrato ? { statusContrato: input.statusContrato } : {}),
      ...(input.search?.trim()
        ? {
            OR: [
              {
                aluno: { nome: { contains: input.search.trim(), mode: 'insensitive' as const } },
              },
              {
                responsavelFinanceiro: {
                  nome: { contains: input.search.trim(), mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      status: true,
      statusContrato: true,
      dataInicio: true,
      dataFimContrato: true,
      rematriculadaDeId: true,
      createdAt: true,
      formaPagamentoTaxa: true,
      vencimentoDia: true,
      taxaMatricula: true,
      taxaIsenta: true,
      taxaJustificativa: true,
      multaPercentual: true,
      jurosMensal: true,
      descontoAntecipado: true,
      descontoTipo: true,
      prazoDesconto: true,
      integrationStatus: true,
      statusFinanceiro: true,
      responsavelFinanceiroId: true,
      matriculaFamiliarId: true,
      aluno: { select: { id: true, nome: true, cpf: true, foto: true } },
      responsavelFinanceiro: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
          foto: true,
        },
      },
      plano: { select: { id: true, nome: true } },
      turma: {
        select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
      },
      combo: { select: { id: true, nome: true } },
      cobrancas: {
        where: {
          status: { in: ['A_VENCER', 'PENDENTE', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
        },
        select: { status: true },
      },
      descontos: {
        select: {
          desconto: {
            select: { id: true, nome: true },
          },
        },
      },
    },
    orderBy: { dataFimContrato: 'asc' },
  });

  const alunoIds = Array.from(new Set(matriculas.map((matricula) => matricula.aluno.id)));
  const chainRows = alunoIds.length
    ? await prisma.matricula.findMany({
        where: {
          contaId: input.contaId,
          alunoId: { in: alunoIds },
        },
        select: {
          id: true,
          alunoId: true,
          rematriculadaDeId: true,
          status: true,
          dataInicio: true,
          dataFimContrato: true,
          createdAt: true,
        },
      })
    : [];

  const chainById = new Map<string, EnrollmentChainRow>(chainRows.map((row) => [row.id, row]));
  const activeRenewalItems =
    input.targetPeriodId && chainRows.length
      ? await prisma.rematriculaItem.findMany({
          where: {
            contaId: input.contaId,
            targetPeriodId: input.targetPeriodId,
            processo: {
              status: { notIn: ['CANCELLED'] },
            },
          },
          select: { matriculaOrigemId: true, matriculaFuturaId: true },
        })
      : [];

  const blockedRootIds = new Set<string>();
  for (const item of activeRenewalItems) {
    const originRootId = resolveEnrollmentRootId(item.matriculaOrigemId, chainById);
    if (chainById.has(originRootId)) blockedRootIds.add(originRootId);

    if (item.matriculaFuturaId) {
      const futureRootId = resolveEnrollmentRootId(item.matriculaFuturaId, chainById);
      if (chainById.has(futureRootId)) blockedRootIds.add(futureRootId);
    }
  }

  const latestByRootId = new Map<string, (typeof matriculas)[number]>();
  for (const matricula of matriculas) {
    const chainRow = chainById.get(matricula.id);
    if (!chainRow) continue;

    const rootId = resolveEnrollmentRootId(matricula.id, chainById);
    if (blockedRootIds.has(rootId)) continue;

    const current = latestByRootId.get(rootId);
    if (!current) {
      latestByRootId.set(rootId, matricula);
      continue;
    }

    const currentChainRow = chainById.get(current.id);
    if (currentChainRow && compareEnrollmentRecency(chainRow, currentChainRow) > 0) {
      latestByRootId.set(rootId, matricula);
    }
  }

  const matriculasElegiveis = Array.from(latestByRootId.values()).sort(
    (a, b) => a.dataFimContrato.getTime() - b.dataFimContrato.getTime(),
  );
  
  const payerEntries: Array<{ payerType: 'ALUNO' | 'RESPONSAVEL'; payerId: string }> = Array.from(
    new Map(
      matriculasElegiveis.map((matricula) => {
        const payerType: 'ALUNO' | 'RESPONSAVEL' = matricula.responsavelFinanceiroId
          ? 'RESPONSAVEL'
          : 'ALUNO';
        const payerId = matricula.responsavelFinanceiroId ?? matricula.aluno.id;
        return [`${payerType}:${payerId}`, { payerType, payerId }];
      }),
    ).values(),
  );
  const matriculaIds = matriculasElegiveis.map((matricula) => matricula.id);
  const familyGroupIds = matriculasElegiveis
    .map((matricula) => matricula.matriculaFamiliarId)
    .filter((id): id is string => Boolean(id));
  const standaloneOwnershipOr: Prisma.ChargeWhereInput[] = [
    ...payerEntries.map((entry) => ({ payerType: entry.payerType, payerId: entry.payerId })),
    ...(familyGroupIds.length > 0 ? [{ familyGroupId: { in: familyGroupIds } }] : []),
    ...(matriculaIds.length > 0
      ? [{ sale: { contaId: input.contaId, matriculaId: { in: matriculaIds } } }]
      : []),
  ];
  const standaloneCharges = standaloneOwnershipOr.length
    ? await prisma.charge.findMany({
        where: {
          contaId: input.contaId,
          cobrancaId: null,
          status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
          OR: standaloneOwnershipOr,
        },
        select: {
          payerType: true,
          payerId: true,
          familyGroupId: true,
          status: true,
          dueDate: true,
          sale: { select: { matriculaId: true } },
        },
      })
    : [];

  type StandaloneStatus = 'A_VENCER' | 'PENDENTE' | 'ATRASADO';
  const standaloneStatusByPayerKey = new Map<string, StandaloneStatus[]>();
  const standaloneStatusByMatriculaId = new Map<string, StandaloneStatus[]>();
  const standaloneStatusByFamilyGroupId = new Map<string, StandaloneStatus[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const charge of standaloneCharges) {
    let mappedStatus: StandaloneStatus = 'PENDENTE';
    if (charge.status === 'OVERDUE') {
      mappedStatus = 'ATRASADO';
    } else if (charge.dueDate) {
      const due = new Date(charge.dueDate);
      due.setHours(0, 0, 0, 0);
      mappedStatus = due < today ? 'ATRASADO' : 'A_VENCER';
    }
  
    if (charge.payerType && charge.payerId) {
      const key = `${charge.payerType}:${charge.payerId}`;
      const current = standaloneStatusByPayerKey.get(key) ?? [];
      current.push(mappedStatus);
      standaloneStatusByPayerKey.set(key, current);
    }
    if (charge.sale?.matriculaId) {
      const current = standaloneStatusByMatriculaId.get(charge.sale.matriculaId) ?? [];
      current.push(mappedStatus);
      standaloneStatusByMatriculaId.set(charge.sale.matriculaId, current);
    }
    if (charge.familyGroupId) {
      const current = standaloneStatusByFamilyGroupId.get(charge.familyGroupId) ?? [];
      current.push(mappedStatus);
      standaloneStatusByFamilyGroupId.set(charge.familyGroupId, current);
    }
  }

  const itens = matriculasElegiveis.map((m) => {
    const diasRestantes = getAcademicDateDifference(m.dataFimContrato, referencia, timeZone);
    const contratoExpirado = diasRestantes < 0;
    // Usar regra canônica de elegibilidade do domínio
    const elegibilidade = validarElegibilidadeRematricula({
      status: m.status,
      contratoExpirado,
      diasContratoExpirado: contratoExpirado ? Math.abs(diasRestantes) : 0,
    });
    const podeRenovar = elegibilidade.success;
    const payerKey = `${m.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO'}:${m.responsavelFinanceiroId ?? m.aluno.id}`;
    const standaloneStatuses = [
      ...(standaloneStatusByPayerKey.get(payerKey) ?? []),
      ...(standaloneStatusByMatriculaId.get(m.id) ?? []),
      ...(m.matriculaFamiliarId
        ? standaloneStatusByFamilyGroupId.get(m.matriculaFamiliarId) ?? []
        : []),
    ];
  
    const combinedChargeSnapshot = [
      ...m.cobrancas,
      ...standaloneStatuses.map((status) => ({ status })),
    ];
  
    const financialSnapshot = buildFinancialSnapshot({
      cobrancas: combinedChargeSnapshot,
      statusFinanceiro: m.statusFinanceiro,
      integrationStatus: m.integrationStatus,
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });
    const decision = evaluateCanonicalRematriculaDecision({
      academicEligible: podeRenovar,
      financialSnapshot,
    });

    return {
      id: m.id,
      status: m.status,
      statusContrato: m.statusContrato,
      dataInicio: m.dataInicio,
      dataFimContrato: m.dataFimContrato,
      diasRestantes,
      contratoExpirado,
      podeRenovar,
      eligibilityStatus: decision.eligibilityStatus,
      matriculaFamiliarId: m.matriculaFamiliarId,
      aluno: {
        id: m.aluno.id,
        nome: m.aluno.nome,
        cpf: m.aluno.cpf,
        foto: m.aluno.foto,
      },
      responsavelFinanceiro: m.responsavelFinanceiro
        ? {
            id: m.responsavelFinanceiro.id,
            nome: m.responsavelFinanceiro.nome,
            cpf: m.responsavelFinanceiro.cpf,
            email: m.responsavelFinanceiro.email,
            telefone: m.responsavelFinanceiro.telefone,
            foto: m.responsavelFinanceiro.foto,
          }
        : null,
      plano: m.plano ? { id: m.plano.id, nome: m.plano.nome } : null,
      turma: m.turma
        ? {
            id: m.turma.id,
            nome: m.turma.nome,
            diasSemana: m.turma.diasSemana,
            horaInicio: m.turma.horaInicio,
            horaFim: m.turma.horaFim,
          }
        : null,
      combo: m.combo ? { id: m.combo.id, nome: m.combo.nome } : null,
      financeiro: {
        pendencias: combinedChargeSnapshot.length,
        cobrancasEmAberto: financialSnapshot.openChargesCount,
        cobrancasAtrasadas: financialSnapshot.overdueChargesCount,
        financialStatus: financialSnapshot.financialStatus,
        rematriculaActionStatus: decision.actionStatus,
        blockReason: decision.blockReason,
        actionMessage: decision.message,
        canCurrentUserOverride: decision.canCurrentUserOverride,
        requiresOverrideReason: decision.requiresOverrideReason,
        shouldBlockNewFinancialCycle: decision.shouldBlockNewFinancialCycle,
        formaPagamento: null,
        formaPagamentoTaxa: m.formaPagamentoTaxa ?? null,
        vencimentoDia: m.vencimentoDia ?? null,
        taxaMatricula: toNullableNumber(m.taxaMatricula),
        taxaIsenta: m.taxaIsenta,
        taxaJustificativa: m.taxaJustificativa,
        multaPercentual: toNullableNumber(m.multaPercentual),
        jurosMensal: toNullableNumber(m.jurosMensal),
        descontoAntecipado: toNullableNumber(m.descontoAntecipado),
        descontoTipo: m.descontoTipo ?? null,
        prazoDesconto: m.prazoDesconto ?? null,
        diasTolerancia: null,
        descontos: m.descontos
          .map((item) => item.desconto)
          .filter((item): item is { id: string; nome: string } => Boolean(item)),
      },
    };
  });

  return {
    referencia,
    ate: limite,
    total: itens.length,
    itens,
  };
}
