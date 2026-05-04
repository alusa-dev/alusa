import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BillingMode, FamilyBillingStatus, FormaPagamento, PeriodicidadePlano } from '@prisma/client';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import {
  calcularPrecoMatricula,
  criarMatricula,
  MatriculaConflictError,
  type CriarMatriculaInput,
} from '@/src/server/matriculas/matricula.service';
import {
  formatIsoDate,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import { processFamilyBillingOutboxEvent } from '@/src/server/family-billing/processor';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

const alunoItemSchema = z.object({
  alunoId: z.string().min(1),
  turmaId: z.string().min(1).optional(),
  comboId: z.string().min(1).optional(),
});

const createMatriculaFamiliarInputSchema = z.object({
  contaId: z.string().min(1).optional(),
  responsavelId: z.string().min(1),
  modoTurmas: z.enum(['COMBO', 'TURMAS']),
  planoId: z.string().min(1).optional(),
  alunos: z.array(alunoItemSchema).min(2),
  descontoIds: z.array(z.string().min(1)).optional().default([]),
  taxaMatricula: z.number().nonnegative().optional().default(0),
  taxaIsenta: z.boolean().optional().default(false),
  taxaJustificativa: z.string().trim().max(500).optional(),
  pagarTaxaAgora: z.boolean().optional().default(false),
  gerarCobrancaTaxa: z.boolean().optional().default(false),
  criarCobranca: z.boolean().optional().default(true),
  vencimentoDia: z.number().int().min(1).max(28),
  formaPagamento: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']),
  formaPagamentoTaxa: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO']).optional(),
  dataInicio: z.string().min(1),
  dataFimContrato: z.string().min(1),
  modeloId: z.string().min(1).optional(),
  multaPercentual: z.number().nonnegative().optional(),
  jurosMensal: z.number().nonnegative().optional(),
  descontoAntecipado: z.number().nonnegative().optional(),
  descontoTipo: z.enum(['FIXED', 'PERCENTAGE']).optional(),
  prazoDesconto: z.number().int().nonnegative().optional(),
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
    const date = new Date(`${normalized}T12:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const date = new Date(normalized);
  if (!Number.isNaN(date.getTime())) return date;
  throw new Error('Data inválida.');
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

  if (records.length !== descontoIds.length) {
    throw new Error('Um ou mais benefícios selecionados não estão disponíveis.');
  }

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
  modoTurmas: 'COMBO' | 'TURMAS';
  planoId?: string;
  alunos: Array<{ alunoId: string; comboId?: string }>;
  descontoIds: string[];
}) {
  const descontos = await resolveDescontos(params.contaId, params.descontoIds);

  if (params.modoTurmas === 'TURMAS') {
    if (!params.planoId) {
      throw new Error('Plano é obrigatório na matrícula familiar por turmas.');
    }

    const plano = await prisma.plano.findFirst({
      where: { id: params.planoId, contaId: params.contaId },
      select: { id: true, nome: true, valor: true, periodicidade: true },
    });

    if (!plano) {
      throw new Error('Plano selecionado não foi encontrado.');
    }

    const calculo = calcularPrecoMatricula({
      planoValor: Number(plano.valor),
      taxaMatricula: 0,
      descontos,
    });

    return {
      totalMensalidade: Number((calculo.planoLiquido * params.alunos.length).toFixed(2)),
      cycle: mapPeriodicidadeToCycle(plano.periodicidade),
      descricao: `Plano familiar ${plano.nome} · ${params.alunos.length} alunos`,
    };
  }

  const comboIds = Array.from(
    new Set(params.alunos.map((aluno) => aluno.comboId).filter((value): value is string => Boolean(value))),
  );

  if (comboIds.length !== params.alunos.length) {
    throw new Error('Todos os alunos familiares precisam de um combo selecionado.');
  }

  const combos = await prisma.combo.findMany({
    where: {
      contaId: params.contaId,
      id: { in: comboIds },
    },
    select: {
      id: true,
      nome: true,
      valor: true,
      periodicidade: true,
    },
  });

  if (combos.length !== comboIds.length) {
    throw new Error('Um ou mais combos familiares não foram encontrados.');
  }

  const comboById = new Map(combos.map((combo) => [combo.id, combo]));
  const periodicidades = new Set(combos.map((combo) => combo.periodicidade));
  if (periodicidades.size > 1) {
    throw new Error('Todos os combos familiares precisam ter a mesma periodicidade de cobrança.');
  }

  let totalMensalidade = 0;
  for (const aluno of params.alunos) {
    const combo = comboById.get(aluno.comboId!);
    if (!combo) continue;
    const calculo = calcularPrecoMatricula({
      planoValor: Number(combo.valor),
      taxaMatricula: 0,
      descontos,
    });
    totalMensalidade += calculo.planoLiquido;
  }

  return {
    totalMensalidade: Number(totalMensalidade.toFixed(2)),
    cycle: mapPeriodicidadeToCycle(combos[0]!.periodicidade),
    descricao: `Combo familiar ${combos[0]!.nome} · ${params.alunos.length} alunos`,
  };
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  }
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para matricular famílias.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = createMatriculaFamiliarInputSchema.parse(raw);
    const contaId = body.contaId?.trim() || user.contaId;

    if (contaId !== user.contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: body.responsavelId, contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável familiar não encontrado.');
    }

    if (body.uiRequestId) {
      const existing = await prisma.matriculaFamiliar.findFirst({
        where: { contaId, uiRequestId: body.uiRequestId },
        include: {
          items: {
            orderBy: { orderIndex: 'asc' },
            include: {
              matricula: {
                select: {
                  id: true,
                  aluno: { select: { id: true, nome: true } },
                },
              },
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
              alunoId: item.matricula.aluno.id,
              alunoNome: item.matricula.aluno.nome,
              status: 'success',
              matriculaId: item.matricula.id,
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

    const alunos = await prisma.aluno.findMany({
      where: {
        contaId,
        id: { in: body.alunos.map((item) => item.alunoId) },
      },
      select: { id: true, nome: true },
    });

    if (alunos.length !== body.alunos.length) {
      return jsonError(404, 'ALUNO_NAO_ENCONTRADO', 'Um ou mais alunos familiares não foram encontrados.');
    }

    const alunoById = new Map(alunos.map((aluno) => [aluno.id, aluno]));
    const pricing = await resolveFamilyPricing({
      contaId,
      modoTurmas: body.modoTurmas,
      planoId: body.planoId,
      alunos: body.alunos,
      descontoIds: body.descontoIds,
    });

    const family = await prisma.matriculaFamiliar.create({
      data: {
        contaId,
        responsavelId: responsavel.id,
        billingMode: BillingMode.SHARED_PLAN,
        status: FamilyBillingStatus.PENDENTE,
        totalAlunos: body.alunos.length,
        valorMensalidadeTotal: pricing.totalMensalidade,
        valorTaxaMatriculaTotal: body.taxaIsenta ? 0 : Number((body.taxaMatricula * body.alunos.length).toFixed(2)),
        formaPagamento: formaPagamento,
        ciclo: pricing.cycle,
        diaVencimento: body.vencimentoDia,
        dataInicio,
        dataFimContrato,
        actorId: user.id,
        uiRequestId: body.uiRequestId,
      },
    });

    const results: Array<{
      alunoId: string;
      alunoNome: string;
      status: 'success' | 'error';
      matriculaId?: string;
      errorMessage?: string;
    }> = [];

    const commonInput: Omit<CriarMatriculaInput, 'alunoId' | 'comboId' | 'turmaId'> = {
      contaId,
      responsavelFinanceiroId: responsavel.id,
      planoId: body.modoTurmas === 'TURMAS' ? body.planoId ?? null : null,
      dataInicio,
      dataFimContrato,
      vencimentoDia: body.vencimentoDia,
      taxaMatricula: body.taxaMatricula,
      taxaIsenta: body.taxaIsenta,
      taxaJustificativa: body.taxaJustificativa ?? null,
      pagarTaxaAgora: false,
      gerarCobrancaTaxa: false,
      criarCobranca: false,
      billingMode: BillingMode.SHARED_PLAN,
      valorMensalidadeOverride: null,
      formaPagamento,
      formaPagamentoTaxa,
      createdById: user.id,
      jurosMensal: body.jurosMensal ?? null,
      multaPercentual: body.multaPercentual ?? null,
      descontoAntecipado: body.descontoAntecipado ?? null,
      descontoTipo: body.descontoTipo ?? null,
      prazoDesconto: body.prazoDesconto ?? null,
      descontoIds: body.descontoIds,
    };

    for (const [index, item] of body.alunos.entries()) {
      const aluno = alunoById.get(item.alunoId);
      if (!aluno) continue;

      try {
        const created = await criarMatricula({
          ...commonInput,
          alunoId: aluno.id,
          turmaId: body.modoTurmas === 'TURMAS' ? item.turmaId ?? null : null,
          comboId: body.modoTurmas === 'COMBO' ? item.comboId ?? null : null,
        });

        await prisma.$transaction([
          prisma.matricula.update({
            where: { id: created.matricula.id },
            data: { matriculaFamiliarId: family.id },
          }),
          prisma.matriculaFamiliarItem.create({
            data: {
              matriculaFamiliarId: family.id,
              matriculaId: created.matricula.id,
              orderIndex: index,
            },
          }),
        ]);

        results.push({
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          status: 'success',
          matriculaId: created.matricula.id,
        });
      } catch (error) {
        const message =
          error instanceof MatriculaConflictError || error instanceof Error
            ? error.message
            : 'Falha ao criar matrícula familiar.';
        results.push({
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          status: 'error',
          errorMessage: message,
        });
      }
    }

    const successCount = results.filter((result) => result.status === 'success').length;
    const failureCount = results.length - successCount;

    if (successCount < 2) {
      await prisma.matriculaFamiliar.update({
        where: { id: family.id },
        data: {
          status: FamilyBillingStatus.FALHO,
          ultimoErro:
            successCount === 0
              ? 'Nenhuma matrícula pôde ser criada no lote familiar.'
              : 'O lote familiar terminou com menos de dois alunos válidos.',
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

    let financialStatus: FamilyBillingStatus = failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.PROCESSANDO;

    const shouldCreateFinancial =
      body.criarCobranca || (!body.taxaIsenta && body.gerarCobrancaTaxa && body.taxaMatricula > 0);

    if (shouldCreateFinancial) {
      const billingType = mapFormaPagamentoToBillingType(formaPagamento);
      if (!billingType || billingType === 'UNDEFINED') {
        return jsonError(
          422,
          'FORMA_PAGAMENTO_INVALIDA',
          'Forma de pagamento familiar não suporta cobrança consolidada.',
        );
      }

      const event = await prisma.familyBillingOutbox.create({
        data: {
          contaId,
          aggregateType: 'MATRICULA_FAMILIAR',
          aggregateId: family.id,
          eventType: 'SYNC_FAMILY_BILLING',
          matriculaFamiliarId: family.id,
          payload: {
            aggregateType: 'MATRICULA_FAMILIAR',
            aggregateId: family.id,
            contaId,
            responsavelId: responsavel.id,
            responsavelNome: responsavel.nome,
            totalAlunos: successCount,
            monthlyValue: body.criarCobranca ? pricing.totalMensalidade : 0,
            enrollmentFeeValue:
              !body.taxaIsenta && body.gerarCobrancaTaxa
                ? Number((body.taxaMatricula * successCount).toFixed(2))
                : 0,
            billingType,
            cycle: pricing.cycle,
            nextDueDate: formatIsoDate(resolveFirstDueDate(dataInicio, body.vencimentoDia)),
            endDate: formatIsoDate(dataFimContrato),
            enrollmentFeeDueDate: formatIsoDate(dataInicio),
            description: `${pricing.descricao} · ${responsavel.nome}`,
            actorId: user.id,
            uiRequestId: body.uiRequestId ?? null,
            notificationChannels: body.notificationChannels,
            notificationChannelsConfigured: body.notificationChannelsConfigured,
          },
        },
      });

      try {
        await processFamilyBillingOutboxEvent(event.id);
        const refreshed = await prisma.matriculaFamiliar.findUnique({
          where: { id: family.id },
          select: { status: true },
        });
        financialStatus = refreshed?.status ?? FamilyBillingStatus.PROCESSANDO;
      } catch (error) {
        console.error('[POST /api/matriculas/familiar] Falha ao processar outbox inline', {
          familyId: family.id,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
        financialStatus = FamilyBillingStatus.FALHO;
      }
    } else {
      await prisma.matriculaFamiliar.update({
        where: { id: family.id },
        data: { status: failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.ATIVO },
      });
      financialStatus = failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.ATIVO;
    }

    return NextResponse.json(
      {
        familyId: family.id,
        status: financialStatus,
        results,
        modeloId: body.modeloId ?? null,
      },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', error.issues[0]?.message ?? 'Payload inválido.', error.issues);
    }

    console.error('[POST /api/matriculas/familiar]', error);
    return jsonError(
      error instanceof MatriculaConflictError ? 409 : 500,
      'ERRO_MATRICULA_FAMILIAR',
      error instanceof Error ? error.message : 'Erro ao criar matrícula familiar.',
    );
  }
}
