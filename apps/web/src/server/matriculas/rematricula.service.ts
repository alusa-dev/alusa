import { StatusContrato, StatusMatricula } from '@prisma/client';
import { prisma } from '@/src/prisma';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  buildFinancialSnapshot,
  evaluateRematriculaDecision,
  getContaFinancialPolicy,
} from './rematricula-financial-policy.service';

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
  aluno: {
    id: string;
    nome: string;
    cpf: string | null;
    foto?: string | null;
  };
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
      | 'POLITICA_DA_ESCOLA'
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
  search?: string;
  currentUserRole?: string | null;
}): Promise<{ referencia: Date; ate: Date; total: number; itens: RematriculaElegivelItem[] }> {
  const diasAntecedencia = Math.max(0, Math.min(365, input.diasAntecedencia ?? 60));
  const referencia = input.referencia ?? new Date();
  const limite = new Date(referencia);
  limite.setDate(limite.getDate() + diasAntecedencia);

  const policy = await getContaFinancialPolicy(input.contaId);

  const matriculas = await prisma.matricula.findMany({
    where: {
      aluno: { contaId: input.contaId },
      status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA] },
      dataFimContrato: { lte: limite },
      ...(input.statusContrato ? { statusContrato: input.statusContrato } : {}),
      ...(input.search?.trim()
        ? {
          OR: [
            {
              aluno: { nome: { contains: input.search.trim(), mode: 'insensitive' as const } },
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
      formaPagamentoTaxa: true,
      vencimentoDia: true,
      taxaMatricula: true,
      taxaIsenta: true,
      taxaJustificativa: true,
      multaPercentual: true,
      jurosMensal: true,
      descontoAntecipado: true,
      prazoDesconto: true,
      integrationStatus: true,
      statusFinanceiro: true,
      responsavelFinanceiroId: true,
      aluno: { select: { id: true, nome: true, cpf: true, foto: true } },
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
  
  const payerKeys = Array.from(
    new Set(
      matriculas.map((m) => {
        const payerType = m.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
        const payerId = m.responsavelFinanceiroId ?? m.aluno.id;
        return `${payerType}:${payerId}`;
      }),
    ),
  );
  
  const payerEntries = payerKeys.map((key) => {
    const [payerType, payerId] = key.split(':');
    return {
      key,
      payerType: payerType as 'ALUNO' | 'RESPONSAVEL',
      payerId,
    };
  });
  
  const customers = payerEntries.length
    ? await prisma.customer.findMany({
        where: {
          contaId: input.contaId,
          OR: payerEntries.map((entry) => ({ payerType: entry.payerType, payerId: entry.payerId })),
        },
        select: {
          id: true,
          payerType: true,
          payerId: true,
        },
      })
    : [];
  
  const customerIds = customers.map((customer) => customer.id);
  const standaloneCharges = customerIds.length
    ? await prisma.charge.findMany({
        where: {
          contaId: input.contaId,
          cobrancaId: null,
          customerId: { in: customerIds },
          status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
        },
        select: {
          customerId: true,
          status: true,
          dueDate: true,
        },
      })
    : [];
  
  const customerByKey = new Map<string, string>();
  for (const customer of customers) {
    customerByKey.set(`${customer.payerType}:${customer.payerId}`, customer.id);
  }
  
  const standaloneStatusByCustomerId = new Map<string, Array<'A_VENCER' | 'PENDENTE' | 'ATRASADO'>>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (const charge of standaloneCharges) {
    if (!charge.customerId) continue;
  
    let mappedStatus: 'A_VENCER' | 'PENDENTE' | 'ATRASADO' = 'PENDENTE';
    if (charge.status === 'OVERDUE') {
      mappedStatus = 'ATRASADO';
    } else if (charge.dueDate) {
      const due = new Date(charge.dueDate);
      due.setHours(0, 0, 0, 0);
      mappedStatus = due < today ? 'ATRASADO' : 'A_VENCER';
    }
  
    const current = standaloneStatusByCustomerId.get(charge.customerId) ?? [];
    current.push(mappedStatus);
    standaloneStatusByCustomerId.set(charge.customerId, current);
  }

  const itens = matriculas.map((m) => {
    const diasRestantes = Math.ceil(
      (m.dataFimContrato.getTime() - referencia.getTime()) / (24 * 60 * 60 * 1000),
    );
    const contratoExpirado = diasRestantes < 0;
    // Usar regra canônica de elegibilidade do domínio
    const elegibilidade = validarElegibilidadeRematricula({ status: m.status, contratoExpirado });
    const podeRenovar = elegibilidade.success;
    const payerKey = `${m.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO'}:${m.responsavelFinanceiroId ?? m.aluno.id}`;
    const customerId = customerByKey.get(payerKey);
    const standaloneStatuses = customerId ? (standaloneStatusByCustomerId.get(customerId) ?? []) : [];
  
    const combinedChargeSnapshot = [
      ...m.cobrancas,
      ...standaloneStatuses.map((status) => ({ status })),
    ];
  
    const financialSnapshot = buildFinancialSnapshot({
      cobrancas: combinedChargeSnapshot,
      statusFinanceiro: m.statusFinanceiro,
      integrationStatus: m.integrationStatus,
      debtScope: policy.debtScope,
    });
    const decision = evaluateRematriculaDecision({
      academicEligible: podeRenovar,
      financialSnapshot,
      policy,
      currentUserRole: input.currentUserRole,
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
      aluno: {
        id: m.aluno.id,
        nome: m.aluno.nome,
        cpf: m.aluno.cpf,
        foto: m.aluno.foto,
      },
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

export async function criarRematricula(input: {
  contaId: string;
  matriculaId: string;
  createdById: string;
  dataInicio: Date;
  dataFimContrato: Date;
  planoId?: string | null;
  turmaId?: string | null;
  comboId?: string | null;
  responsavelFinanceiroId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const origem = await tx.matricula.findFirst({
      where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
      select: {
        id: true,
        dataInicio: true,
        dataFimContrato: true,
        turmaId: true,
        planoId: true,
      },
    });

    if (!origem) throw new Error('Matrícula não encontrada');

    const historicoContrato = {
      dataInicioAnterior: origem.dataInicio,
      dataFimContratoAnterior: origem.dataFimContrato,
      turmaIdAnterior: origem.turmaId,
      planoIdAnterior: origem.planoId,
    };

    const matriculaRenovada = await tx.matricula.update({
      where: { id: origem.id },
      data: {
        dataInicio: input.dataInicio,
        dataFimContrato: input.dataFimContrato,
        turmaId: input.turmaId ?? undefined,
        planoId: input.planoId ?? undefined,
        comboId: input.comboId ?? undefined,
        responsavelFinanceiroId: input.responsavelFinanceiroId ?? undefined,
      },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: origem.id,
        actorId: input.createdById,
        action: 'REMATRICULA',
        metadata: {
          historicoContrato,
        },
      },
    });

    return { matriculaRenovada, historicoContrato };
  });
}
