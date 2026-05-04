import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BillingMode, FamilyBillingStatus, FormaPagamento, PeriodicidadePlano } from '@prisma/client';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  rematricularAluno,
  createAsaasPaymentsProvider,
  type RematricularAlunoError,
} from '@alusa/finance';
import { calcularPrecoMatricula } from '@/src/server/matriculas/matricula.service';
import {
  buildFinancialSnapshot,
  evaluateRematriculaDecision,
  getContaFinancialPolicy,
  serializeFinancialSnapshot,
  serializePolicySnapshot,
} from '@/src/server/matriculas/rematricula-financial-policy.service';
import {
  formatIsoDate,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import { processFamilyBillingOutboxEvent } from '@/src/server/family-billing/processor';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

const rematriculaItemSchema = z.object({
  matriculaId: z.string().min(1),
  turmaId: z.string().min(1).optional().nullable(),
  planoId: z.string().min(1).optional().nullable(),
  comboId: z.string().min(1).optional().nullable(),
});

const descontoSchema = z.object({
  id: z.string().min(1),
  cumulativo: z.boolean().optional().default(false),
});

const createRematriculaFamiliarInputSchema = z.object({
  contaId: z.string().min(1).optional(),
  responsavelId: z.string().min(1),
  itens: z.array(rematriculaItemSchema).min(2),
  dataInicio: z.string().min(1),
  dataFimContrato: z.string().min(1),
  formaPagamento: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']),
  formaPagamentoTaxa: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).optional(),
  vencimentoDia: z.number().int().min(1).max(28),
  taxaMatricula: z.number().nonnegative().optional().default(0),
  taxaIsenta: z.boolean().optional().default(false),
  taxaJustificativa: z.string().trim().max(500).optional(),
  descontos: z.array(descontoSchema).optional().default([]),
  multaPercentual: z.number().nonnegative().optional(),
  jurosMensal: z.number().nonnegative().optional(),
  descontoAntecipado: z.number().nonnegative().optional(),
  prazoDesconto: z.number().int().nonnegative().optional(),
  overrideReason: z.string().trim().max(500).optional(),
  notificationChannels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).optional().default([]),
  notificationChannelsConfigured: z.boolean().optional().default(false),
  uiRequestId: z.string().trim().min(1).max(120).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value: string) {
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T12:00:00.000Z`);
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida.');
  return date;
}

function normalizeFormaPagamento(value: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO') {
  switch (value) {
    case 'PIX':
      return FormaPagamento.PIX;
    case 'CARTAO_CREDITO':
      return FormaPagamento.CARTAO_CREDITO;
    case 'BOLETO':
    default:
      return FormaPagamento.BOLETO;
  }
}

async function loadRematriculaDecision(params: {
  contaId: string;
  matriculaId: string;
  currentUserRole?: string | null;
}) {
  const [policy, matricula] = await Promise.all([
    getContaFinancialPolicy(params.contaId),
    prisma.matricula.findFirst({
      where: { id: params.matriculaId, aluno: { contaId: params.contaId } },
      select: {
        id: true,
        status: true,
        dataFimContrato: true,
        integrationStatus: true,
        statusFinanceiro: true,
        cobrancas: {
          where: {
            status: {
              in: ['A_VENCER', 'PENDENTE', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'],
            },
          },
          select: { status: true },
        },
      },
    }),
  ]);

  if (!matricula) return null;

  const diasRestantes = Math.ceil(
    (matricula.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const academicEligible = validarElegibilidadeRematricula({
    status: matricula.status,
    contratoExpirado: diasRestantes < 0,
  }).success;

  const financialSnapshot = buildFinancialSnapshot({
    cobrancas: matricula.cobrancas,
    statusFinanceiro: matricula.statusFinanceiro,
    integrationStatus: matricula.integrationStatus,
    debtScope: policy.debtScope,
  });

  const decision = evaluateRematriculaDecision({
    academicEligible,
    financialSnapshot,
    policy,
    currentUserRole: params.currentUserRole,
  });

  return { policy, financialSnapshot, decision };
}

async function resolveDescontos(contaId: string, descontoIds: string[]) {
  if (descontoIds.length === 0) return [];
  const records = await prisma.desconto.findMany({
    where: {
      contaId,
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

  return records.map((record) => ({
    id: record.id,
    nome: record.nome,
    tipo: record.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
    valor: Number(record.valor),
    escopo: record.escopo,
  }));
}

async function resolveFamilyPricing(params: {
  contaId: string;
  itens: Array<{ matriculaId: string; planoId?: string | null; comboId?: string | null }>;
  descontos: Array<{ id: string }>;
}) {
  const sourceMatriculas = await prisma.matricula.findMany({
    where: {
      aluno: { contaId: params.contaId },
      id: { in: params.itens.map((item) => item.matriculaId) },
    },
    select: {
      id: true,
      planoId: true,
      comboId: true,
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
      combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
    },
  });

  if (sourceMatriculas.length !== params.itens.length) {
    throw new Error('Uma ou mais matrículas selecionadas não foram encontradas.');
  }

  const sourceById = new Map(sourceMatriculas.map((item) => [item.id, item]));
  const descontos = await resolveDescontos(
    params.contaId,
    params.descontos.map((desconto) => desconto.id),
  );

  let total = 0;
  const periodicidades = new Set<PeriodicidadePlano>();

  for (const item of params.itens) {
    const source = sourceById.get(item.matriculaId);
    if (!source) continue;

    const plano = item.planoId
      ? await prisma.plano.findFirst({
          where: { id: item.planoId, contaId: params.contaId },
          select: { id: true, nome: true, valor: true, periodicidade: true },
        })
      : source.plano;
    const combo = item.comboId
      ? await prisma.combo.findFirst({
          where: { id: item.comboId, contaId: params.contaId },
          select: { id: true, nome: true, valor: true, periodicidade: true },
        })
      : source.combo;

    const periodicidade = combo?.periodicidade ?? plano?.periodicidade;
    const valorBase = Number(combo?.valor ?? plano?.valor ?? 0);
    if (!periodicidade || valorBase <= 0) {
      throw new Error('Não foi possível calcular a recorrência de uma das rematrículas familiares.');
    }

    periodicidades.add(periodicidade);
    const calculo = calcularPrecoMatricula({
      planoValor: valorBase,
      taxaMatricula: 0,
      descontos,
    });
    total += calculo.planoLiquido;
  }

  if (periodicidades.size !== 1) {
    throw new Error('As rematrículas familiares precisam compartilhar a mesma periodicidade.');
  }

  return {
    totalMensalidade: Number(total.toFixed(2)),
    cycle: mapPeriodicidadeToCycle(Array.from(periodicidades)[0]!),
  };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  }
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematrícula familiar.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = createRematriculaFamiliarInputSchema.parse(raw);
    const contaId = body.contaId?.trim() || user.contaId;

    if (contaId !== user.contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: body.responsavelId, contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável não encontrado.');
    }

    if (body.uiRequestId) {
      const existing = await prisma.rematriculaFamiliar.findFirst({
        where: { contaId, uiRequestId: body.uiRequestId },
        include: {
          items: {
            orderBy: { orderIndex: 'asc' },
            include: {
              matriculaOrigem: {
                select: { id: true, aluno: { select: { id: true, nome: true } } },
              },
              novaMatricula: { select: { id: true } },
            },
          },
        },
      });

      if (existing) {
        return NextResponse.json(
          {
            familyId: existing.id,
            status: existing.status,
            results: existing.items.map((item) => ({
              matriculaId: item.matriculaOrigem.id,
              alunoId: item.matriculaOrigem.aluno.id,
              alunoNome: item.matriculaOrigem.aluno.nome,
              status: item.novaMatriculaId ? 'success' : 'error',
              novaMatriculaId: item.novaMatricula?.id ?? null,
              errorMessage: item.erro ?? null,
            })),
          },
          { status: 200, headers: { 'cache-control': 'no-store' } },
        );
      }
    }

    const dataInicio = parseDate(body.dataInicio);
    const dataFimContrato = parseDate(body.dataFimContrato);
    const formaPagamento = normalizeFormaPagamento(body.formaPagamento);
    const formaPagamentoTaxa = body.formaPagamentoTaxa
      ? normalizeFormaPagamento(body.formaPagamentoTaxa)
      : formaPagamento;

    const pricing = await resolveFamilyPricing({
      contaId,
      itens: body.itens,
      descontos: body.descontos,
    });

    const family = await prisma.rematriculaFamiliar.create({
      data: {
        contaId,
        responsavelId: responsavel.id,
        billingMode: BillingMode.SHARED_PLAN,
        status: FamilyBillingStatus.PENDENTE,
        totalAlunos: body.itens.length,
        valorMensalidadeTotal: pricing.totalMensalidade,
        valorTaxaMatriculaTotal: body.taxaIsenta
          ? 0
          : Number((body.taxaMatricula * body.itens.length).toFixed(2)),
        formaPagamento,
        ciclo: pricing.cycle,
        diaVencimento: body.vencimentoDia,
        dataInicio,
        dataFimContrato,
        actorId: user.id,
        uiRequestId: body.uiRequestId,
      },
    });

    const results: Array<{
      matriculaId: string;
      alunoId: string;
      alunoNome: string;
      status: 'success' | 'error';
      novaMatriculaId?: string;
      errorMessage?: string;
    }> = [];

    const matriculas = await prisma.matricula.findMany({
      where: {
        id: { in: body.itens.map((item) => item.matriculaId) },
        aluno: { contaId },
      },
      select: {
        id: true,
        aluno: { select: { id: true, nome: true } },
      },
    });

    const matriculaById = new Map(matriculas.map((item) => [item.id, item]));

    for (const [index, item] of body.itens.entries()) {
      const source = matriculaById.get(item.matriculaId);
      if (!source) continue;

      const decisionContext = await loadRematriculaDecision({
        contaId,
        matriculaId: item.matriculaId,
        currentUserRole: user.role,
      });

      if (!decisionContext) {
        results.push({
          matriculaId: item.matriculaId,
          alunoId: source.aluno.id,
          alunoNome: source.aluno.nome,
          status: 'error',
          errorMessage: 'Matrícula não encontrada.',
        });
        continue;
      }

      const overrideReason = body.overrideReason?.trim();
      const policySnapshot = serializePolicySnapshot(decisionContext.policy);
      const financialSnapshot = serializeFinancialSnapshot(decisionContext.financialSnapshot);

      if (decisionContext.decision.actionStatus === 'BLOQUEADA') {
        results.push({
          matriculaId: item.matriculaId,
          alunoId: source.aluno.id,
          alunoNome: source.aluno.nome,
          status: 'error',
          errorMessage: decisionContext.decision.message,
        });
        continue;
      }

      if (
        decisionContext.decision.actionStatus === 'REQUER_OVERRIDE' &&
        (!decisionContext.decision.canCurrentUserOverride ||
          (decisionContext.decision.requiresOverrideReason && !overrideReason))
      ) {
        results.push({
          matriculaId: item.matriculaId,
          alunoId: source.aluno.id,
          alunoNome: source.aluno.nome,
          status: 'error',
          errorMessage: decisionContext.decision.message,
        });
        continue;
      }

      const formaPagamentoMap: Record<string, 'BOLETO' | 'PIX' | 'CARTAO_CREDITO'> = {
        BOLETO: 'BOLETO',
        PIX: 'PIX',
        CARTAO_CREDITO: 'CARTAO_CREDITO',
      };

      const result = await rematricularAluno(
        {
          contaId,
          matriculaId: item.matriculaId,
          createdById: user.id,
          dataInicio,
          dataFimContrato,
          planoId: item.planoId ?? null,
          turmaId: item.turmaId ?? null,
          comboId: item.comboId ?? null,
          responsavelFinanceiroId: responsavel.id,
          formaPagamento: formaPagamentoMap[formaPagamento],
          vencimentoDia: body.vencimentoDia,
          billingMode: 'SHARED_PLAN',
          valorMensalidadeOverride: undefined,
          taxaMatricula: body.taxaMatricula,
          taxaIsenta: body.taxaIsenta,
          taxaJustificativa: body.taxaJustificativa,
          formaPagamentoTaxa: formaPagamentoMap[formaPagamentoTaxa],
          criarCobranca: false,
          descontos: body.descontos.map((desconto) => ({
            id: desconto.id,
            cumulativo: desconto.cumulativo === true,
          })),
          multaPercentual: body.multaPercentual,
          jurosMensal: body.jurosMensal,
          descontoAntecipado: body.descontoAntecipado,
          prazoDesconto: body.prazoDesconto,
          overrideReason: overrideReason || undefined,
          policyContext: {
            actionStatus: decisionContext.decision.actionStatus,
            blockReason: decisionContext.decision.blockReason,
            policySnapshot,
            financialSnapshot,
            overrideUsed: decisionContext.decision.actionStatus === 'REQUER_OVERRIDE',
            overrideApprovedById:
              decisionContext.decision.actionStatus === 'REQUER_OVERRIDE' ? user.id : undefined,
          },
        },
        {
          prisma,
          paymentsProvider: createAsaasPaymentsProvider(),
        },
      );

      if (!result.success) {
        const mapped = mapRematriculaError(result.error);
        await prisma.rematriculaFamiliarItem.create({
          data: {
            rematriculaFamiliarId: family.id,
            matriculaOrigemId: item.matriculaId,
            orderIndex: index,
            status: 'ERRO',
            erro: mapped,
          },
        });
        results.push({
          matriculaId: item.matriculaId,
          alunoId: source.aluno.id,
          alunoNome: source.aluno.nome,
          status: 'error',
          errorMessage: mapped,
        });
        continue;
      }

      await prisma.rematriculaFamiliarItem.create({
        data: {
          rematriculaFamiliarId: family.id,
          matriculaOrigemId: item.matriculaId,
          novaMatriculaId: result.data.matriculaIdNova,
          orderIndex: index,
          status: 'SUCESSO',
        },
      });
      results.push({
        matriculaId: item.matriculaId,
        alunoId: source.aluno.id,
        alunoNome: source.aluno.nome,
        status: 'success',
        novaMatriculaId: result.data.matriculaIdNova,
      });
    }

    const successCount = results.filter((result) => result.status === 'success').length;
    if (successCount < 2) {
      await prisma.rematriculaFamiliar.update({
        where: { id: family.id },
        data: {
          status: FamilyBillingStatus.FALHO,
          ultimoErro: 'O lote de rematrícula familiar terminou com menos de dois alunos válidos.',
        },
      });

      return NextResponse.json(
        {
          familyId: family.id,
          status: FamilyBillingStatus.FALHO,
          results,
        },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }

    let financialStatus: FamilyBillingStatus = results.some((result) => result.status === 'error')
      ? FamilyBillingStatus.PARCIAL
      : FamilyBillingStatus.PROCESSANDO;

    const billingType = mapFormaPagamentoToBillingType(formaPagamento);
    if (!billingType || billingType === 'UNDEFINED') {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento não suporta cobrança familiar.',
      );
    }

    const event = await prisma.familyBillingOutbox.create({
      data: {
        contaId,
        aggregateType: 'REMATRICULA_FAMILIAR',
        aggregateId: family.id,
        eventType: 'SYNC_FAMILY_BILLING',
        rematriculaFamiliarId: family.id,
        payload: {
          aggregateType: 'REMATRICULA_FAMILIAR',
          aggregateId: family.id,
          contaId,
          responsavelId: responsavel.id,
          responsavelNome: responsavel.nome,
          totalAlunos: successCount,
          monthlyValue: pricing.totalMensalidade,
          enrollmentFeeValue:
            !body.taxaIsenta && body.taxaMatricula > 0
              ? Number((body.taxaMatricula * successCount).toFixed(2))
              : 0,
          billingType,
          cycle: pricing.cycle,
          nextDueDate: formatIsoDate(resolveFirstDueDate(dataInicio, body.vencimentoDia)),
          endDate: formatIsoDate(dataFimContrato),
          enrollmentFeeDueDate: formatIsoDate(dataInicio),
          description: `Rematrícula familiar · ${responsavel.nome} · ${successCount} alunos`,
          actorId: user.id,
          uiRequestId: body.uiRequestId ?? null,
          notificationChannels: body.notificationChannels,
          notificationChannelsConfigured: body.notificationChannelsConfigured,
        },
      },
    });

    try {
      await processFamilyBillingOutboxEvent(event.id);
      const refreshed = await prisma.rematriculaFamiliar.findUnique({
        where: { id: family.id },
        select: { status: true },
      });
      financialStatus = refreshed?.status ?? FamilyBillingStatus.PROCESSANDO;
    } catch (error) {
      console.error('[POST /api/rematriculas/familiar] Falha ao processar outbox inline', {
        familyId: family.id,
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      financialStatus = FamilyBillingStatus.FALHO;
    }

    return NextResponse.json(
      {
        familyId: family.id,
        status: financialStatus,
        results,
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', error.issues[0]?.message ?? 'Payload inválido.', error.issues);
    }

    console.error('[POST /api/rematriculas/familiar]', error);
    return jsonError(
      500,
      'ERRO_REMATRICULA_FAMILIAR',
      error instanceof Error ? error.message : 'Erro ao criar rematrícula familiar.',
    );
  }
}

function mapRematriculaError(error: RematricularAlunoError) {
  const messages: Record<string, string> = {
    MATRICULA_NAO_ENCONTRADA: 'Matrícula não encontrada.',
    MATRICULA_PERTENCE_OUTRA_CONTA: 'Matrícula não pertence a esta conta.',
    STATUS_INVALIDO: 'Status da matrícula não permite rematrícula.',
    TURMA_SEM_VAGAS: 'Turma não possui vagas disponíveis.',
    COMBO_SEM_VAGAS: 'Combo atingiu limite de vagas.',
    CONFLITO_HORARIO: 'Conflito de horário detectado.',
    DATA_INICIO_INVALIDA: 'Data de início inválida.',
    DATA_FIM_ANTES_INICIO: 'Data fim deve ser posterior à data início.',
    RESPONSAVEL_OBRIGATORIO_MENOR: 'Aluno menor de idade requer responsável financeiro.',
    PLANO_NAO_ENCONTRADO: 'Plano não encontrado.',
    TURMA_NAO_ENCONTRADA: 'Turma não encontrada.',
    COMBO_NAO_ENCONTRADO: 'Combo não encontrado.',
    OPERACAO_EM_ANDAMENTO: 'Já existe uma rematrícula em andamento.',
    ERRO_PROVEDOR: 'Erro ao processar pagamento.',
  };
  return messages[error.code] ?? ('message' in error ? error.message : 'Erro desconhecido.');
}
