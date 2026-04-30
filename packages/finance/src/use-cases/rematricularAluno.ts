/**
 * RematricularAlunoUseCase — Fluxo SAGA/2-fases de rematrícula
 * 
 * Arquitetura escalável e "à prova de falha":
 * 
 * FASE 1 (Prepare):
 * 1. Validar acadêmico (capacidade, conflitos, datas, elegibilidade)
 * 2. Resolver pagador (regra imutável: maior = aluno, menor = responsável)
 * 3. Criar operação (RematriculaOperacao com status PENDING, step VALIDATED)
 * 4. Resolver/criar customer (no provedor)
 * 5. Criar nova matrícula em estado PROVISÓRIO (AGUARDANDO_CONFIRMACAO)
 * 6. Criar nova assinatura no gateway
 * 
 * FASE 2 (Commit) — somente após gateway OK:
 * 7. Ativar nova matrícula (status ATIVA)
 * 8. Cancelar matrícula origem + assinatura origem
 * 9. Atualizar operação para COMMITTED
 * 
 * Em caso de FALHA na Fase 1:
 * - NÃO cancela origem
 * - Marca operação como FAILED
 * - Permite retry idempotente via retryRematricula()
 * 
 * Invariantes:
 * - Nenhum termo do provedor vaza para resposta
 * - Status financeiro só muda via webhook
 * - Pagador é imutável (segue regra de maioridade)
 * - Origem só é cancelada após gateway confirmar nova assinatura
 */

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type {
  PrismaClient,
  PeriodicidadePlano,
  CustomerPayerType,
  RematriculaOperacaoStep,
  RematriculaActionStatus,
  RematriculaBlockReason,
} from '@prisma/client';
import {
  resolvePayer,
  validarCapacidadeRematricula,
  validarConflitosRematricula,
  validarDatasRematricula,
  validarElegibilidadeRematricula,
  getDomainSeatOccupyingStatuses,
  type TurmaInfo,
  type TurmaHorario,
} from '@alusa/domain';
import type { PaymentsProviderPort, BillingCycle, BillingType } from '../ports/PaymentsProviderPort';

// ============================================================================
// TIPOS
// ============================================================================

export interface RematricularAlunoInput {
  contaId: string;
  matriculaId: string;
  createdById: string;
  dataInicio: Date;
  dataFimContrato: Date;
  planoId?: string | null;
  turmaId?: string | null;
  comboId?: string | null;
  responsavelFinanceiroId?: string | null;
  vencimentoDia?: number;
  formaPagamento?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO';
  // Taxa de matrícula
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  taxaJustificativa?: string;
  formaPagamentoTaxa?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO';
  // Configurações financeiras opcionais
  descontos?: Array<{ id: string; cumulativo?: boolean }>;
  multaPercentual?: number;
  jurosMensal?: number;
  descontoAntecipado?: number;
  prazoDesconto?: number;
  // Idempotência: permite retry seguro
  idempotencyKey?: string;
  overrideReason?: string;
  policyContext?: {
    actionStatus: RematriculaActionStatus;
    blockReason: RematriculaBlockReason;
    policySnapshot: Prisma.InputJsonValue;
    financialSnapshot: Prisma.InputJsonValue;
    overrideUsed: boolean;
    overrideApprovedById?: string;
  };
}

export interface RematricularAlunoOutput {
  operationId: string;
  status: 'PENDING' | 'PENDING_FINANCE' | 'COMMITTED';
  step: RematriculaOperacaoStep;
  matriculaIdNova: string;
  uiMessage: string;
}

export type RematricularAlunoError =
  | { code: 'MATRICULA_NAO_ENCONTRADA' }
  | { code: 'MATRICULA_PERTENCE_OUTRA_CONTA' }
  | { code: 'STATUS_INVALIDO'; details: string }
  | { code: 'TURMA_SEM_VAGAS'; turmaId: string; turmaNome: string }
  | { code: 'COMBO_SEM_VAGAS' }
  | { code: 'CONFLITO_HORARIO'; turma1: string; turma2: string }
  | { code: 'DATA_INICIO_INVALIDA' }
  | { code: 'DATA_FIM_ANTES_INICIO' }
  | { code: 'RESPONSAVEL_OBRIGATORIO_MENOR' }
  | { code: 'PLANO_NAO_ENCONTRADO' }
  | { code: 'TURMA_NAO_ENCONTRADA' }
  | { code: 'COMBO_NAO_ENCONTRADO' }
  | { code: 'OPERACAO_EM_ANDAMENTO' }
  | { code: 'OPERACAO_NAO_ENCONTRADA' }
  | { code: 'OPERACAO_PERTENCE_OUTRA_CONTA' }
  | { code: 'STATUS_NAO_PERMITE_RETRY' }
  | { code: 'ERRO_PROVEDOR'; message: string };

export type RematricularAlunoResult =
  | { success: true; data: RematricularAlunoOutput }
  | { success: false; error: RematricularAlunoError };

// ============================================================================
// DEPENDÊNCIAS
// ============================================================================

export interface RematricularAlunoDeps {
  prisma: PrismaClient;
  paymentsProvider: PaymentsProviderPort;
}

// ============================================================================
// HELPERS
// ============================================================================

function periodicidadeToCycle(periodicidade: PeriodicidadePlano): BillingCycle {
  const map: Record<PeriodicidadePlano, BillingCycle> = {
    SEMANAL: 'WEEKLY',
    QUINZENAL: 'BIWEEKLY',
    MENSAL: 'MONTHLY',
    TRIMESTRAL: 'QUARTERLY',
    ANUAL: 'YEARLY',
  };
  return map[periodicidade] ?? 'MONTHLY';
}

function formaPagamentoToBillingType(forma?: string): BillingType {
  if (forma === 'PIX') return 'PIX';
  if (forma === 'CARTAO_CREDITO') return 'CREDIT_CARD';
  return 'BOLETO';
}

function formatDateYYYYMMDD(date: Date): string {
  return date.toISOString().split('T')[0];
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type DescontoResolvido = {
  id: string;
  nome: string;
  tipo: 'FIXO' | 'PERCENTUAL';
  valor: number;
  cumulativo?: boolean;
};

async function resolveRematriculaDescontos(
  prisma: PrismaClient,
  contaId: string,
  descontos: Array<{ id: string; cumulativo?: boolean }> | undefined,
): Promise<DescontoResolvido[]> {
  if (!descontos?.length) return [] as DescontoResolvido[];

  const ids = Array.from(new Set(descontos.map((item) => item.id).filter(Boolean)));
  const records = await prisma.desconto.findMany({
    where: {
      contaId,
      id: { in: ids },
      status: 'ATIVO',
    },
    select: {
      id: true,
      nome: true,
      tipo: true,
      valor: true,
    },
  });

  if (records.length !== ids.length) {
    throw new Error('Um ou mais benefícios herdados não estão disponíveis.');
  }

  return records.map<DescontoResolvido>((record) => ({
    id: record.id,
    nome: record.nome,
    tipo: record.tipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO',
    valor: Number(record.valor),
    cumulativo: descontos.find((item) => item.id === record.id)?.cumulativo,
  }));
}

function calcularValorPlanoLiquido(
  valorPlano: number,
  descontos: DescontoResolvido[],
) {
  const descontosAplicados = descontos.map((desconto) => {
    if (desconto.tipo === 'PERCENTUAL') {
      return round2(valorPlano * (desconto.valor / 100));
    }
    return round2(desconto.valor);
  });

  const hasCumulativo = descontos.some((desconto) => desconto.cumulativo);
  const efetivos = hasCumulativo
    ? descontosAplicados
    : descontosAplicados.length > 0
      ? [Math.max(...descontosAplicados)]
      : [];

  const totalDescontos = round2(efetivos.reduce((acc, item) => acc + item, 0));
  return {
    valorPlanoLiquido: Math.max(0, round2(valorPlano - totalDescontos)),
    descontosAplicados: efetivos,
  };
}

function mapDescontosAplicadosDaMatricula(
  descontos: Array<{
    desconto: {
      id: string;
      nome: string;
      tipo: string;
      valor: Prisma.Decimal | number;
    };
  }>,
): DescontoResolvido[] {
  return descontos.map<DescontoResolvido>((item) => ({
    id: item.desconto.id,
    nome: item.desconto.nome,
    tipo: item.desconto.tipo === 'PERCENTUAL' ? 'PERCENTUAL' : 'FIXO',
    valor: Number(item.desconto.valor),
    cumulativo: false,
  }));
}

async function aplicarDescontosNaNovaMatricula(
  prisma: PrismaClient,
  matriculaId: string,
  valorPlano: number,
  descontos: DescontoResolvido[],
  descontosAplicados: number[],
) {
  if (!descontos.length || !descontosAplicados.length) return;

  const detalhes = descontos
    .map((desconto) => ({
      desconto,
      valorAplicado:
        desconto.tipo === 'PERCENTUAL'
          ? round2(valorPlano * (desconto.valor / 100))
          : round2(desconto.valor),
    }))
    .sort((a, b) => b.valorAplicado - a.valorAplicado);

  const restantes = [...descontosAplicados];
  for (const item of detalhes) {
    const index = restantes.findIndex((value) => Math.abs(value - item.valorAplicado) < 0.01);
    if (index < 0) continue;

    await prisma.descontoMatricula.create({
      data: {
        matriculaId,
        descontoId: item.desconto.id,
        valorFinal: item.valorAplicado,
      },
    });
    restantes.splice(index, 1);
    if (!restantes.length) break;
  }
}

function resolveFirstDueDate(dataInicio: Date, vencimentoDia: number): Date {
  const base = new Date(dataInicio);
  const day = Math.min(28, Math.max(1, vencimentoDia));
  const due = new Date(base.getFullYear(), base.getMonth(), day);
  if (due <= base) {
    return new Date(base.getFullYear(), base.getMonth() + 1, day);
  }
  return due;
}

function buildRematriculaIdempotencyKey(input: RematricularAlunoInput): string {
  return [
    'rematricula',
    input.contaId,
    input.matriculaId,
    input.dataInicio.toISOString().slice(0, 10),
    input.dataFimContrato.toISOString().slice(0, 10),
    input.planoId ?? 'plano-origem',
    input.turmaId ?? 'sem-turma',
    input.comboId ?? 'sem-combo',
  ].join(':');
}

// ============================================================================
// USE CASE
// ============================================================================

export async function rematricularAluno(
  input: RematricularAlunoInput,
  deps: RematricularAlunoDeps
): Promise<RematricularAlunoResult> {
  const { prisma, paymentsProvider } = deps;
  const correlationId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? buildRematriculaIdempotencyKey(input);

  const operacaoPorIdempotencia = await prisma.rematriculaOperacao.findFirst({
    where: { idempotencyKey },
  });

  if (operacaoPorIdempotencia?.status === 'COMMITTED' && operacaoPorIdempotencia.matriculaNovaId) {
    return {
      success: true,
      data: {
        operationId: operacaoPorIdempotencia.id,
        status: 'COMMITTED',
        step: 'COMPLETED',
        matriculaIdNova: operacaoPorIdempotencia.matriculaNovaId,
        uiMessage: 'Rematrícula já estava concluída.',
      },
    };
  }

  if (operacaoPorIdempotencia && ['PENDING', 'PENDING_FINANCE'].includes(operacaoPorIdempotencia.status)) {
    return { success: false, error: { code: 'OPERACAO_EM_ANDAMENTO' } };
  }

  if (operacaoPorIdempotencia?.status === 'FAILED') {
    return retryRematricula(
      {
        operacaoId: operacaoPorIdempotencia.id,
        contaId: input.contaId,
        createdById: input.createdById,
      },
      deps,
    );
  }

  // -------------------------------------------------------------------------
  // 1. PREPARAR CONTEXTO
  // -------------------------------------------------------------------------

  const matriculaOrigem = await prisma.matricula.findUnique({
    where: { id: input.matriculaId },
    include: {
      aluno: {
        select: {
          id: true,
          contaId: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
          dataNasc: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          asaasCustomerId: true,
        },
      },
      responsavelFinanceiro: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          asaasCustomerId: true,
        },
      },
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true, status: true } },
      turma: {
        select: {
          id: true,
          nome: true,
          capacidade: true,
          diasSemana: true,
          horaInicio: true,
          horaFim: true,
          status: true,
        },
      },
      combo: {
        select: {
          id: true,
          nome: true,
          valor: true,
          periodicidade: true,
          vagasLimite: true,
          status: true,
          turmas: {
            include: {
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
      },
    },
  });

  if (!matriculaOrigem) {
    return { success: false, error: { code: 'MATRICULA_NAO_ENCONTRADA' } };
  }

  if (matriculaOrigem.aluno.contaId !== input.contaId) {
    return { success: false, error: { code: 'MATRICULA_PERTENCE_OUTRA_CONTA' } };
  }

  // Verificar se já existe operação em andamento
  const operacaoExistente = await prisma.rematriculaOperacao.findFirst({
    where: {
      matriculaOrigemId: input.matriculaId,
      status: { in: ['PENDING', 'PENDING_FINANCE'] },
    },
  });

  if (operacaoExistente) {
    return { success: false, error: { code: 'OPERACAO_EM_ANDAMENTO' } };
  }

  // -------------------------------------------------------------------------
  // 2. VALIDAR ACADÊMICO
  // -------------------------------------------------------------------------

  // 2.1 Elegibilidade
  const diasRestantes = Math.ceil(
    (matriculaOrigem.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );
  const elegibilidadeResult = validarElegibilidadeRematricula({
    status: matriculaOrigem.status,
    contratoExpirado: diasRestantes < 0,
  });
  if (!elegibilidadeResult.success) {
    return { success: false, error: { code: 'STATUS_INVALIDO', details: elegibilidadeResult.error } };
  }

  // 2.2 Datas
  const datasResult = validarDatasRematricula({
    dataFimContratoOrigem: matriculaOrigem.dataFimContrato,
    novaDataInicio: input.dataInicio,
    novaDataFimContrato: input.dataFimContrato,
  });
  if (!datasResult.success) {
    return { success: false, error: { code: datasResult.error } };
  }

  // Resolver plano/turma/combo destino
  const planoDestino = input.planoId
    ? await prisma.plano.findFirst({
        where: { id: input.planoId, contaId: input.contaId, status: 'ATIVO' },
        select: { id: true, nome: true, valor: true, periodicidade: true },
      })
    : matriculaOrigem.plano;

  if (input.planoId && !planoDestino) {
    return { success: false, error: { code: 'PLANO_NAO_ENCONTRADO' } };
  }

  const turmaDestino = input.turmaId === null
    ? null
    : input.turmaId
      ? await prisma.turma.findFirst({
          where: { id: input.turmaId, contaId: input.contaId, status: 'ATIVO' },
          select: {
            id: true,
            nome: true,
            capacidade: true,
            diasSemana: true,
            horaInicio: true,
            horaFim: true,
          },
        })
      : matriculaOrigem.turma;

  if (input.turmaId && !turmaDestino) {
    return { success: false, error: { code: 'TURMA_NAO_ENCONTRADA' } };
  }

  const comboDestino = input.comboId === null
    ? null
    : input.comboId
      ? await prisma.combo.findFirst({
          where: { id: input.comboId, contaId: input.contaId, status: 'ATIVO' },
          include: {
            turmas: {
              include: {
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
      : matriculaOrigem.combo;

  if (input.comboId && !comboDestino) {
    return { success: false, error: { code: 'COMBO_NAO_ENCONTRADO' } };
  }

  // Coletar turmas para validação (usa status canônicos que ocupam vaga)
  const seatStatuses = getDomainSeatOccupyingStatuses();
  const turmasParaValidar: (TurmaInfo & TurmaHorario)[] = [];
  if (turmaDestino) {
    const count = await prisma.matricula.count({
      where: { turmaId: turmaDestino.id, status: { in: seatStatuses }, id: { not: input.matriculaId } },
    });
    turmasParaValidar.push({
      ...turmaDestino,
      matriculasAtivas: count,
    });
  }
  if (comboDestino) {
    for (const ct of comboDestino.turmas) {
      const count = await prisma.matricula.count({
        where: {
          OR: [
            { turmaId: ct.turma.id },
            { combo: { turmas: { some: { turmaId: ct.turma.id } } } },
          ],
          status: { in: seatStatuses },
          id: { not: input.matriculaId },
        },
      });
      turmasParaValidar.push({
        ...ct.turma,
        matriculasAtivas: count,
      });
    }
  }

  // 2.3 Capacidade
  const comboMatriculasAtivas = comboDestino
    ? await prisma.matricula.count({
        where: { comboId: comboDestino.id, status: { in: seatStatuses }, id: { not: input.matriculaId } },
      })
    : 0;

  const capacidadeResult = validarCapacidadeRematricula({
    turmas: turmasParaValidar,
    comboVagasLimite: comboDestino?.vagasLimite,
    comboMatriculasAtivas,
    matriculaIdAtual: input.matriculaId,
  });
  if (!capacidadeResult.success) {
    if (capacidadeResult.error === 'TURMA_SEM_VAGAS') {
      return {
        success: false,
        error: { code: 'TURMA_SEM_VAGAS', turmaId: capacidadeResult.turmaId, turmaNome: capacidadeResult.turmaNome },
      };
    }
    return { success: false, error: { code: 'COMBO_SEM_VAGAS' } };
  }

  // 2.4 Conflitos de horário (considera apenas matrículas ativas para conflito)
  const turmasExistentes = await prisma.matricula.findMany({
    where: { alunoId: matriculaOrigem.alunoId, status: { in: seatStatuses }, id: { not: input.matriculaId } },
    include: {
      turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
      combo: {
        include: {
          turmas: {
            include: {
              turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
            },
          },
        },
      },
    },
  });

  const turmasExistentesFlat: TurmaHorario[] = turmasExistentes.flatMap((m) => {
    const result: TurmaHorario[] = [];
    if (m.turma) result.push(m.turma);
    if (m.combo) {
      for (const ct of m.combo.turmas) {
        result.push(ct.turma);
      }
    }
    return result;
  });

  const conflitosResult = validarConflitosRematricula({
    alunoId: matriculaOrigem.alunoId,
    novasTurmas: turmasParaValidar,
    turmasExistentes: turmasExistentesFlat,
    matriculaIdAtual: input.matriculaId,
  });
  if (!conflitosResult.success) {
    return {
      success: false,
      error: { code: 'CONFLITO_HORARIO', turma1: conflitosResult.turma1, turma2: conflitosResult.turma2 },
    };
  }

  // -------------------------------------------------------------------------
  // 3. RESOLVER PAGADOR (REGRA IMUTÁVEL)
  // -------------------------------------------------------------------------

  const responsavelId = input.responsavelFinanceiroId ?? matriculaOrigem.responsavelFinanceiroId;
  const payerResult = resolvePayer({
    alunoId: matriculaOrigem.alunoId,
    alunoDataNasc: matriculaOrigem.aluno.dataNasc,
    responsavelFinanceiroId: responsavelId,
  });

  if (!payerResult.success) {
    return { success: false, error: { code: 'RESPONSAVEL_OBRIGATORIO_MENOR' } };
  }

  const payer = payerResult.payer;

  // -------------------------------------------------------------------------
  // 4. CRIAR OPERAÇÃO (FASE 1 - PREPARE)
  // -------------------------------------------------------------------------

  const operacao = await prisma.rematriculaOperacao.create({
    data: {
      correlationId,
      contaId: input.contaId,
      matriculaOrigemId: input.matriculaId,
      status: 'PENDING',
      step: 'VALIDATED',
      idempotencyKey,
      payerType: payer.type as CustomerPayerType,
      payerId: payer.id,
      oldSubscriptionId: matriculaOrigem.asaasSubscriptionId,
      policySnapshot: input.policyContext?.policySnapshot,
      financialSnapshot: input.policyContext?.financialSnapshot,
      actionStatus: input.policyContext?.actionStatus,
      blockReason: input.policyContext?.blockReason ?? 'SEM_BLOQUEIO',
      overrideUsed: input.policyContext?.overrideUsed ?? false,
      overrideReason: input.overrideReason,
      overrideApprovedById: input.policyContext?.overrideApprovedById,
      evaluatedAt: new Date(),
      createdById: input.createdById,
    },
  }).catch(async (error: unknown) => {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrentOperation = await prisma.rematriculaOperacao.findFirst({
        where: { idempotencyKey },
      });

      if (concurrentOperation?.status === 'COMMITTED' && concurrentOperation.matriculaNovaId) {
        return concurrentOperation;
      }

      throw new Error('OPERACAO_EM_ANDAMENTO');
    }

    throw error;
  });

  if (operacao.status === 'COMMITTED' && operacao.matriculaNovaId) {
    return {
      success: true,
      data: {
        operationId: operacao.id,
        status: 'COMMITTED',
        step: 'COMPLETED',
        matriculaIdNova: operacao.matriculaNovaId,
        uiMessage: 'Rematrícula já estava concluída.',
      },
    };
  }

  // Log início
  await prisma.matriculaLog.create({
    data: {
      matriculaId: input.matriculaId,
      action: 'REMATRICULA_INICIADA',
      actorId: input.createdById,
      metadata: {
        correlationId,
        operacaoId: operacao.id,
        payerType: payer.type,
        payerId: payer.id,
        contratoAnterior: {
          dataInicio: matriculaOrigem.dataInicio,
          dataFimContrato: matriculaOrigem.dataFimContrato,
        },
        novoContrato: {
          dataInicio: input.dataInicio,
          dataFimContrato: input.dataFimContrato,
        },
        policyContext: input.policyContext ?? null,
        overrideReason: input.overrideReason ?? null,
      },
    },
  });

  try {
    // -------------------------------------------------------------------------
    // 5. RESOLVER/CRIAR CUSTOMER
    // -------------------------------------------------------------------------

    const payerData = payer.type === 'ALUNO'
      ? {
          type: 'ALUNO' as const,
          id: matriculaOrigem.aluno.id,
          name: matriculaOrigem.aluno.nome,
          cpfCnpj: matriculaOrigem.aluno.cpf ?? '',
          email: matriculaOrigem.aluno.email ?? undefined,
          phone: matriculaOrigem.aluno.telefone ?? undefined,
          address: {
            postalCode: matriculaOrigem.aluno.enderecoCep ?? undefined,
            street: matriculaOrigem.aluno.enderecoLogradouro ?? undefined,
            number: matriculaOrigem.aluno.enderecoNumero ?? undefined,
            complement: matriculaOrigem.aluno.enderecoComplemento ?? undefined,
            neighborhood: matriculaOrigem.aluno.enderecoBairro ?? undefined,
          },
        }
      : {
          type: 'RESPONSAVEL' as const,
          id: matriculaOrigem.responsavelFinanceiro!.id,
          name: matriculaOrigem.responsavelFinanceiro!.nome,
          cpfCnpj: matriculaOrigem.responsavelFinanceiro!.cpf,
          email: matriculaOrigem.responsavelFinanceiro!.email ?? undefined,
          phone: matriculaOrigem.responsavelFinanceiro!.telefone ?? undefined,
          address: {
            postalCode: matriculaOrigem.responsavelFinanceiro!.enderecoCep ?? undefined,
            street: matriculaOrigem.responsavelFinanceiro!.enderecoLogradouro ?? undefined,
            number: matriculaOrigem.responsavelFinanceiro!.enderecoNumero ?? undefined,
            complement: matriculaOrigem.responsavelFinanceiro!.enderecoComplemento ?? undefined,
            neighborhood: matriculaOrigem.responsavelFinanceiro!.enderecoBairro ?? undefined,
          },
        };

    const externalReference = `${payer.type.toLowerCase()}-${payer.id}`;

    const customerResult = await paymentsProvider.resolveOrCreateCustomerForPayer({
      contaId: input.contaId,
      payer: payerData,
      externalReference,
    });

    // Atualizar asaasCustomerId no pagador correto
    if (customerResult.created) {
      if (payer.type === 'ALUNO') {
        await prisma.aluno.update({
          where: { id: payer.id },
          data: { asaasCustomerId: customerResult.customerId },
        });
      } else {
        await prisma.responsavel.update({
          where: { id: payer.id },
          data: { asaasCustomerId: customerResult.customerId },
        });
      }
    }

    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: { customerId: customerResult.customerId },
    });

    // -------------------------------------------------------------------------
    // 6. CRIAR NOVA MATRÍCULA (PROVISÓRIA - status AGUARDANDO_CONFIRMACAO)
    // -------------------------------------------------------------------------
    // IMPORTANTE: A matrícula é criada em estado provisório.
    // Só será ativada após o gateway confirmar a nova assinatura.
    // Isso evita cancelar a origem antes de garantir que a nova está ok.

    const vencimentoDia = input.vencimentoDia ?? matriculaOrigem.vencimentoDia ?? 5;
    const valorPlano = comboDestino
      ? Number(comboDestino.valor)
      : planoDestino
        ? Number(planoDestino.valor)
        : 0;
    const descontosResolvidos = await resolveRematriculaDescontos(
      prisma,
      input.contaId,
      input.descontos,
    );
    const { valorPlanoLiquido, descontosAplicados } = calcularValorPlanoLiquido(
      valorPlano,
      descontosResolvidos,
    );
    const periodicidade = comboDestino?.periodicidade ?? planoDestino?.periodicidade ?? 'MENSAL';

    const taxaIsenta = input.taxaIsenta ?? false;
    const taxaValor = taxaIsenta ? 0 : (input.taxaMatricula ?? 0);
    const taxaStatus = taxaIsenta ? 'ISENTO' : (taxaValor > 0 ? 'PENDENTE' : 'ISENTO');

    const novaMatricula = await prisma.matricula.create({
      data: {
        alunoId: matriculaOrigem.alunoId,
        responsavelFinanceiroId: responsavelId,
        turmaId: turmaDestino?.id ?? null,
        planoId: planoDestino?.id ?? null,
        comboId: comboDestino?.id ?? null,
        rematriculadaDeId: input.matriculaId,
        dataInicio: input.dataInicio,
        dataFimContrato: input.dataFimContrato,
        // FASE 1: Status provisório até gateway confirmar
        status: 'AGUARDANDO_CONFIRMACAO',
        statusFinanceiro: 'PENDENTE_FINANCEIRO',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        taxaMatricula: taxaValor,
        taxaIsenta,
        taxaStatus,
        taxaJustificativa: input.taxaJustificativa ?? null,
        formaPagamentoTaxa: input.formaPagamentoTaxa ?? matriculaOrigem.formaPagamentoTaxa ?? 'BOLETO',
        vencimentoDia,
        jurosMensal: input.jurosMensal ?? matriculaOrigem.jurosMensal,
        multaPercentual: input.multaPercentual ?? matriculaOrigem.multaPercentual,
        descontoAntecipado: input.descontoAntecipado ?? matriculaOrigem.descontoAntecipado,
        prazoDesconto: input.prazoDesconto ?? matriculaOrigem.prazoDesconto,
      },
    });

    await aplicarDescontosNaNovaMatricula(
      prisma,
      novaMatricula.id,
      valorPlano,
      descontosResolvidos,
      descontosAplicados,
    );

    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: { 
        matriculaNovaId: novaMatricula.id,
        step: 'NEW_MATRICULA_CREATED',
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: novaMatricula.id,
        action: 'REMATRICULA_MATRICULA_PROVISORIA_CRIADA',
        actorId: input.createdById,
        metadata: {
          correlationId,
          operacaoId: operacao.id,
          statusProvisorio: 'AGUARDANDO_CONFIRMACAO',
        },
      },
    });

    // -------------------------------------------------------------------------
    // 7. CRIAR NOVA ASSINATURA NO GATEWAY
    // -------------------------------------------------------------------------

    const nextDueDate = resolveFirstDueDate(input.dataInicio, vencimentoDia);

    const subscriptionResult = await paymentsProvider.createSubscription({
      contaId: input.contaId,
      customerId: customerResult.customerId,
      value: valorPlanoLiquido,
      nextDueDate: formatDateYYYYMMDD(nextDueDate),
      cycle: periodicidadeToCycle(periodicidade),
      billingType: formaPagamentoToBillingType(input.formaPagamento),
      description: `Mensalidade - ${matriculaOrigem.aluno.nome}`,
      externalReference: `rematricula-${operacao.id}`,
      endDate: formatDateYYYYMMDD(input.dataFimContrato),
      discount: input.descontoAntecipado
        ? { value: input.descontoAntecipado, dueDateLimitDays: input.prazoDesconto ?? 0, type: 'PERCENTAGE' }
        : undefined,
      interest: input.jurosMensal ? { value: input.jurosMensal } : undefined,
      fine: input.multaPercentual ? { value: input.multaPercentual, type: 'PERCENTAGE' } : undefined,
    });

    // Atualizar matrícula com subscriptionId
    await prisma.matricula.update({
      where: { id: novaMatricula.id },
      data: { asaasSubscriptionId: subscriptionResult.subscriptionId },
    });

    // Atualizar operação - assinatura criada
    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: {
        newSubscriptionId: subscriptionResult.subscriptionId,
        step: 'SUBSCRIPTION_CREATED',
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: novaMatricula.id,
        action: 'REMATRICULA_PRIMEIRO_CICLO_AGUARDANDO_WEBHOOK',
        actorId: input.createdById,
        metadata: {
          correlationId,
          asaasSubscriptionId: subscriptionResult.subscriptionId,
          nextDueDate: subscriptionResult.nextDueDate,
          expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
        },
      },
    });

    // -------------------------------------------------------------------------
    // 7.2 CRIAR TAXA DE MATRÍCULA AVULSA (quando não isenta)
    // -------------------------------------------------------------------------

    if (!taxaIsenta && taxaValor > 0) {
      const taxaDueDate = formatDateYYYYMMDD(input.dataInicio);
      const taxaExternalReference = `taxa-rematricula-${operacao.id}`;
      const taxaBillingType = formaPagamentoToBillingType(input.formaPagamentoTaxa);

      // Criar cobrança local TAXA_MATRICULA
      const cobrancaTaxa = await prisma.cobranca.create({
        data: {
          matriculaId: novaMatricula.id,
          tipo: 'TAXA_MATRICULA',
          descricao: 'Taxa de rematrícula',
          competenciaInicio: input.dataInicio,
          competenciaFim: input.dataInicio,
          valor: taxaValor,
          vencimento: input.dataInicio,
          formaPagamento: input.formaPagamentoTaxa ?? 'BOLETO',
          status: 'PENDENTE',
        },
      });

      // Criar pagamento avulso no gateway
      try {
        const taxaPaymentResult = await paymentsProvider.createPayment({
          contaId: input.contaId,
          customerId: customerResult.customerId,
          billingType: taxaBillingType,
          value: taxaValor,
          dueDate: taxaDueDate,
          description: `Taxa de rematrícula - ${matriculaOrigem.aluno.nome}`,
          externalReference: taxaExternalReference,
        });

        await prisma.cobranca.update({
          where: { id: cobrancaTaxa.id },
          data: {
            asaasPaymentId: taxaPaymentResult.paymentId,
            asaasStatus: taxaPaymentResult.status,
            status: 'A_VENCER',
          },
        });

        await prisma.matriculaLog.create({
          data: {
            matriculaId: novaMatricula.id,
            action: 'REMATRICULA_TAXA_CRIADA_ASAAS',
            actorId: input.createdById,
            metadata: {
              correlationId,
              cobrancaId: cobrancaTaxa.id,
              asaasPaymentId: taxaPaymentResult.paymentId,
              valor: taxaValor,
            },
          },
        });
      } catch (taxaError) {
        // Taxa local criada; falha no gateway não bloqueia — webhook ou reconciliação resolve
        console.warn('[rematricularAluno] Falha ao criar taxa no gateway:', taxaError);
        await prisma.matriculaLog.create({
          data: {
            matriculaId: novaMatricula.id,
            action: 'REMATRICULA_TAXA_GATEWAY_FALHA',
            actorId: input.createdById,
            metadata: {
              correlationId,
              cobrancaId: cobrancaTaxa.id,
              error: taxaError instanceof Error ? taxaError.message : String(taxaError),
            },
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // 8. FASE 2 (COMMIT) - Gateway OK, agora podemos:
    //    - Ativar nova matrícula
    //    - Cancelar assinatura anterior
    //    - Cancelar matrícula origem
    // -------------------------------------------------------------------------

    // 8.1 Ativar nova matrícula
    await prisma.matricula.update({
      where: { id: novaMatricula.id },
      data: {
        status: 'ATIVA',
        statusContrato: 'ATIVO',
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: novaMatricula.id,
        action: 'REMATRICULA_MATRICULA_ATIVADA',
        actorId: input.createdById,
        metadata: {
          correlationId,
          operacaoId: operacao.id,
          motivo: 'Gateway confirmou nova assinatura',
        },
      },
    });

    // 8.2 Cancelar assinatura anterior (se existir)
    if (matriculaOrigem.asaasSubscriptionId) {
      await paymentsProvider.cancelSubscription({
        contaId: input.contaId,
        subscriptionId: matriculaOrigem.asaasSubscriptionId,
      });

      await prisma.matriculaLog.create({
        data: {
          matriculaId: input.matriculaId,
          action: 'ASSINATURA_ANTERIOR_CANCELADA',
          actorId: input.createdById,
          metadata: {
            correlationId,
            subscriptionId: matriculaOrigem.asaasSubscriptionId,
          },
        },
      });
    }

    // 8.3 Encerrar matrícula origem (SOMENTE após gateway confirmar nova assinatura)
    await prisma.matricula.update({
      where: { id: input.matriculaId },
      data: {
        status: 'CANCELADA',
        statusContrato: 'EXPIRADO',
        dataFim: new Date(),
      },
    });

    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: { step: 'ORIGIN_CANCELLED' },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        action: 'REMATRICULA_ORIGEM_ENCERRADA',
        actorId: input.createdById,
        metadata: {
          correlationId,
          operacaoId: operacao.id,
          novaMatriculaId: novaMatricula.id,
        },
      },
    });

    // 8.4 Marcar operação como COMMITTED
    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: {
        status: 'COMMITTED',
        step: 'COMPLETED',
        blockedAt: null,
      },
    });

    // Log conclusão
    await prisma.matriculaLog.create({
      data: {
        matriculaId: novaMatricula.id,
        action: 'REMATRICULA_CONCLUIDA',
        actorId: input.createdById,
        metadata: {
          correlationId,
          operacaoId: operacao.id,
          matriculaOrigemId: input.matriculaId,
          subscriptionId: subscriptionResult.subscriptionId,
          customerId: customerResult.customerId,
          overrideUsed: input.policyContext?.overrideUsed ?? false,
          overrideReason: input.overrideReason ?? null,
        },
      },
    });

    // -------------------------------------------------------------------------
    // 9. RETORNAR DTO NEUTRO
    // -------------------------------------------------------------------------

    return {
      success: true,
      data: {
        operationId: operacao.id,
        status: 'COMMITTED',
        step: 'COMPLETED',
        matriculaIdNova: novaMatricula.id,
        uiMessage: 'Rematrícula realizada com sucesso. Nova matrícula ativada.',
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'OPERACAO_EM_ANDAMENTO') {
      return { success: false, error: { code: 'OPERACAO_EM_ANDAMENTO' } };
    }

    // Marcar operação como falha (permite retry)
    // IMPORTANTE: A matrícula origem NÃO foi cancelada, pois falhou antes da FASE 2
    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: {
        status: 'FAILED',
        errorCode: 'ERRO_PROVEDOR',
        errorMessage: error instanceof Error ? error.message : String(error),
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        action: 'REMATRICULA_FALHOU',
        actorId: input.createdById,
        metadata: {
          correlationId,
          operacaoId: operacao.id,
          error: error instanceof Error ? error.message : String(error),
          origemPreservada: true,
          motivo: 'Falha antes da FASE 2 - matrícula origem mantida intacta',
        },
      },
    });

    return {
      success: false,
      error: {
        code: 'ERRO_PROVEDOR',
        message: error instanceof Error ? error.message : 'Erro ao processar rematrícula',
      },
    };
  }
}

// ============================================================================
// RETRY REMATRÍCULA (IDEMPOTENTE)
// ============================================================================

export interface RetryRematriculaInput {
  operacaoId: string;
  contaId: string;
  createdById: string;
}

export type RetryRematriculaError =
  | { code: 'OPERACAO_NAO_ENCONTRADA' }
  | { code: 'OPERACAO_PERTENCE_OUTRA_CONTA' }
  | { code: 'STATUS_NAO_PERMITE_RETRY' }
  | { code: 'ERRO_PROVEDOR'; message: string };

export type RetryRematriculaResult =
  | { success: true; data: RematricularAlunoOutput }
  | { success: false; error: RetryRematriculaError };

/**
 * Retry idempotente de uma operação de rematrícula que falhou.
 * 
 * Regras:
 * - Só pode fazer retry de operações com status FAILED
 * - Retoma do step onde parou
 * - Idempotente: se já está COMMITTED, retorna sucesso
 */
export async function retryRematricula(
  input: RetryRematriculaInput,
  deps: RematricularAlunoDeps
): Promise<RetryRematriculaResult> {
  const { prisma, paymentsProvider } = deps;

  // 1. Buscar operação
  const operacao = await prisma.rematriculaOperacao.findUnique({
    where: { id: input.operacaoId },
    include: {
      matriculaOrigem: {
        include: {
          aluno: {
            select: {
              id: true,
              contaId: true,
              nome: true,
              cpf: true,
              email: true,
              telefone: true,
              dataNasc: true,
              enderecoCep: true,
              enderecoLogradouro: true,
              enderecoNumero: true,
              enderecoComplemento: true,
              enderecoBairro: true,
              asaasCustomerId: true,
            },
          },
          responsavelFinanceiro: {
            select: {
              id: true,
              nome: true,
              cpf: true,
              email: true,
              telefone: true,
              enderecoCep: true,
              enderecoLogradouro: true,
              enderecoNumero: true,
              enderecoComplemento: true,
              enderecoBairro: true,
              asaasCustomerId: true,
            },
          },
        },
      },
      matriculaNova: {
        include: {
          descontos: {
            include: {
              desconto: {
                select: {
                  id: true,
                  nome: true,
                  tipo: true,
                  valor: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!operacao) {
    return { success: false, error: { code: 'OPERACAO_NAO_ENCONTRADA' } };
  }

  if (operacao.contaId !== input.contaId) {
    return { success: false, error: { code: 'OPERACAO_PERTENCE_OUTRA_CONTA' } };
  }

  // 2. Verificar se permite retry
  if (operacao.status === 'COMMITTED' || operacao.status === 'DONE') {
    // Já concluída - retornar sucesso (idempotência)
    return {
      success: true,
      data: {
        operationId: operacao.id,
        status: 'COMMITTED',
        step: 'COMPLETED',
        matriculaIdNova: operacao.matriculaNovaId!,
        uiMessage: 'Rematrícula já estava concluída.',
      },
    };
  }

  if (operacao.status === 'CANCELLED') {
    return { success: false, error: { code: 'STATUS_NAO_PERMITE_RETRY' } };
  }

  if (operacao.status !== 'FAILED') {
    return { success: false, error: { code: 'STATUS_NAO_PERMITE_RETRY' } };
  }

  // 3. Log retry
  await prisma.matriculaLog.create({
    data: {
      matriculaId: operacao.matriculaOrigemId,
      action: 'REMATRICULA_RETRY_INICIADO',
      actorId: input.createdById,
      metadata: {
        operacaoId: operacao.id,
        correlationId: operacao.correlationId,
        stepAnterior: operacao.step,
        tentativa: operacao.retryCount + 1,
      },
    },
  });

  // 4. Atualizar status para PENDING
  await prisma.rematriculaOperacao.update({
    where: { id: operacao.id },
    data: {
      status: 'PENDING',
      errorCode: null,
      errorMessage: null,
    },
  });

  try {
    // 5. Retomar do step onde parou
    const currentStep = operacao.step;
    const matriculaOrigem = operacao.matriculaOrigem;
    const novaMatricula = operacao.matriculaNova;

    // Se não tem matrícula nova, precisa criar
    if (!novaMatricula && (currentStep === 'VALIDATED' || currentStep === 'NEW_MATRICULA_CREATED')) {
      // Precisa recriar a matrícula - isso é mais complexo
      // Por segurança, retornar erro e pedir nova tentativa completa
      return {
        success: false,
        error: {
          code: 'ERRO_PROVEDOR',
          message: 'Estado inconsistente. Execute uma nova rematrícula.',
        },
      };
    }

    // Se tem matrícula nova mas não tem assinatura
    if (novaMatricula && !operacao.newSubscriptionId && currentStep !== 'COMPLETED') {
      // Precisa criar assinatura no gateway
      const plano = await prisma.plano.findFirst({
        where: { id: novaMatricula.planoId ?? '' },
        select: { valor: true, periodicidade: true },
      });
      const combo = novaMatricula.comboId
        ? await prisma.combo.findFirst({
            where: { id: novaMatricula.comboId },
            select: { valor: true, periodicidade: true },
          })
        : null;

      const valorPlano = combo ? Number(combo.valor) : plano ? Number(plano.valor) : 0;
      const descontosResolvidos = mapDescontosAplicadosDaMatricula(novaMatricula.descontos);
      const { valorPlanoLiquido } = calcularValorPlanoLiquido(valorPlano, descontosResolvidos);
      const periodicidade = combo?.periodicidade ?? plano?.periodicidade ?? 'MENSAL';
      const nextDueDate = resolveFirstDueDate(novaMatricula.dataInicio, novaMatricula.vencimentoDia);

      const subscriptionResult = await paymentsProvider.createSubscription({
        contaId: input.contaId,
        customerId: operacao.customerId!,
        value: valorPlanoLiquido,
        nextDueDate: formatDateYYYYMMDD(nextDueDate),
        cycle: periodicidadeToCycle(periodicidade),
        billingType: formaPagamentoToBillingType(undefined),
        description: `Mensalidade - ${matriculaOrigem.aluno.nome}`,
        externalReference: `rematricula-${operacao.id}`,
        endDate: formatDateYYYYMMDD(novaMatricula.dataFimContrato),
      });

      await prisma.matricula.update({
        where: { id: novaMatricula.id },
        data: { asaasSubscriptionId: subscriptionResult.subscriptionId },
      });

      await prisma.rematriculaOperacao.update({
        where: { id: operacao.id },
        data: {
          newSubscriptionId: subscriptionResult.subscriptionId,
          step: 'SUBSCRIPTION_CREATED',
        },
      });
    }

    // 6. FASE 2 (COMMIT) - se assinatura foi criada
    const updatedOperacao = await prisma.rematriculaOperacao.findUnique({
      where: { id: operacao.id },
    });

    if (
      updatedOperacao?.newSubscriptionId &&
      updatedOperacao.step !== 'COMPLETED' &&
      updatedOperacao.step !== 'ORIGIN_CANCELLED'
    ) {
      // Ativar nova matrícula
      await prisma.matricula.update({
        where: { id: novaMatricula!.id },
        data: {
          status: 'ATIVA',
          statusContrato: 'ATIVO',
        },
      });

      // Cancelar assinatura anterior
      if (matriculaOrigem.asaasSubscriptionId) {
        await paymentsProvider.cancelSubscription({
          contaId: input.contaId,
          subscriptionId: matriculaOrigem.asaasSubscriptionId,
        });
      }

      // Encerrar matrícula origem
      await prisma.matricula.update({
        where: { id: matriculaOrigem.id },
        data: {
          status: 'CANCELADA',
          statusContrato: 'EXPIRADO',
          dataFim: new Date(),
        },
      });

      await prisma.rematriculaOperacao.update({
        where: { id: operacao.id },
        data: { step: 'ORIGIN_CANCELLED' },
      });
    }

    // 7. Marcar como COMMITTED
    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: {
        status: 'COMMITTED',
        step: 'COMPLETED',
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId: novaMatricula!.id,
        action: 'REMATRICULA_RETRY_CONCLUIDO',
        actorId: input.createdById,
        metadata: {
          operacaoId: operacao.id,
          correlationId: operacao.correlationId,
          tentativa: operacao.retryCount + 1,
        },
      },
    });

    return {
      success: true,
      data: {
        operationId: operacao.id,
        status: 'COMMITTED',
        step: 'COMPLETED',
        matriculaIdNova: novaMatricula!.id,
        uiMessage: 'Rematrícula concluída com sucesso (retry).',
      },
    };
  } catch (error) {
    await prisma.rematriculaOperacao.update({
      where: { id: operacao.id },
      data: {
        status: 'FAILED',
        errorCode: 'ERRO_PROVEDOR',
        errorMessage: error instanceof Error ? error.message : String(error),
        retryCount: { increment: 1 },
        lastRetryAt: new Date(),
      },
    });

    return {
      success: false,
      error: {
        code: 'ERRO_PROVEDOR',
        message: error instanceof Error ? error.message : 'Erro ao processar retry',
      },
    };
  }
}
