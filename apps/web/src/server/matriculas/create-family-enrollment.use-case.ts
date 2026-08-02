import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import {
  BillingMode,
  FamilyAcademicStatus,
  FamilyBillingStatus,
  FormaPagamento,
  MatriculaBillingProvisionStatus,
  Prisma,
} from '@prisma/client';

import { prisma } from '@/prisma/client';
import {
  calcularPrecoMatricula,
  criarMatricula,
  MatriculaConflictError,
  type CriarMatriculaInput,
} from '@/src/server/matriculas/matricula.service';
import { previewInitialEnrollmentBilling } from '@/src/server/matriculas/initial-enrollment-billing-preview.service';
import {
  formatIsoDate,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
  resolveEnrollmentFeeDueDate,
} from '@/src/server/matriculas/recurring-billing';
import {
  isSupportedAsaasBillingType,
  resolveWizardPaymentSelection,
} from '@/src/server/matriculas/payment-selection';
import {
  enqueueFamilyBillingOutbox,
  markFamilyBillingFailed,
  parseFamilyBillingPayload,
  type FamilyBillingPayload,
} from '@alusa/finance/family-billing/processor';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { evaluateResponsavelPayerFiscalReadiness } from '@alusa/finance';
import { allocateFamilyAmount } from '@alusa/finance/family-billing/allocation';
import { findUnlinkedStudentIds } from '@/src/server/responsaveis/linked-students.service';
import type { CreateMatriculaFamiliarBody } from './family-enrollment.schema';

export type CreateFamilyEnrollmentActor = {
  id: string;
  contaId: string;
};

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

function buildBillingAdjustments(body: CreateMatriculaFamiliarBody) {
  const discountValue = Number(body.descontoAntecipado ?? 0);
  const interestValue = Number(body.jurosMensal ?? 0);
  const fineValue = Number(body.multaPercentual ?? 0);

  return {
    discount:
      Number.isFinite(discountValue) && discountValue > 0
        ? {
            value: discountValue,
            dueDateLimitDays: body.prazoDesconto ?? 0,
            type: body.descontoTipo ?? ('PERCENTAGE' as const),
          }
        : undefined,
    interest:
      Number.isFinite(interestValue) && interestValue > 0 ? { value: interestValue } : undefined,
    fine:
      Number.isFinite(fineValue) && fineValue > 0
        ? { value: fineValue, type: 'PERCENTAGE' as const }
        : undefined,
  };
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
      totalMensalidade: Number(calculo.planoLiquido.toFixed(2)),
      totalBaseMensalidade: Number(plano.valor),
      cycle: mapPeriodicidadeToCycle(plano.periodicidade),
      descricao: `Plano familiar ${plano.nome} · ${params.alunos.length} matrícula(s)`,
      allocationMethod: 'EQUAL_SPLIT' as const,
      itemWeights: params.alunos.map(() => 1),
      itemBaseWeights: params.alunos.map(() => 1),
    };
  }

  const comboIds = Array.from(
    new Set(
      params.alunos
        .map((aluno) => aluno.comboId)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (params.alunos.some((aluno) => !aluno.comboId)) {
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
  let totalBaseMensalidade = 0;
  const itemWeights: number[] = [];
  const itemBaseWeights: number[] = [];
  for (const aluno of params.alunos) {
    const combo = comboById.get(aluno.comboId!);
    if (!combo) continue;
    const calculo = calcularPrecoMatricula({
      planoValor: Number(combo.valor),
      taxaMatricula: 0,
      descontos,
    });
    totalMensalidade += calculo.planoLiquido;
    totalBaseMensalidade += Number(combo.valor);
    itemWeights.push(calculo.planoLiquido);
    itemBaseWeights.push(Number(combo.valor));
  }

  return {
    totalMensalidade: Number(totalMensalidade.toFixed(2)),
    totalBaseMensalidade: Number(totalBaseMensalidade.toFixed(2)),
    cycle: mapPeriodicidadeToCycle(combos[0]!.periodicidade),
    descricao: `Combo familiar ${combos[0]!.nome} · ${params.alunos.length} matrícula(s)`,
    allocationMethod: 'PRODUCT_PROPORTIONAL' as const,
    itemWeights,
    itemBaseWeights,
  };
}

type FamilyResultItem = {
  itemId: string;
  alunoId: string;
  alunoNome: string;
  status: 'success' | 'error';
  matriculaId?: string;
  contratoId?: string;
  errorMessage?: string;
};

export async function executeCreateFamilyEnrollment(params: {
  body: CreateMatriculaFamiliarBody;
  actor: CreateFamilyEnrollmentActor;
  contaId: string;
}) {
  const { body, actor: user, contaId } = params;
  const requestFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        responsavelId: body.responsavelId,
        modoTurmas: body.modoTurmas,
        planoId: body.planoId ?? null,
        alunos: body.alunos,
        descontoIds: body.descontoIds,
        taxaMatricula: body.taxaMatricula,
        taxaIsenta: body.taxaIsenta,
        taxaJustificativa: body.taxaJustificativa ?? null,
        gerarCobrancaTaxa: body.gerarCobrancaTaxa,
        criarCobranca: body.criarCobranca,
        dataInicio: body.dataInicio,
        dataFimContrato: body.dataFimContrato,
        modeloId: body.modeloId,
        vencimentoDia: body.vencimentoDia,
        formaPagamento: body.formaPagamento,
        formaPagamentoTaxa: body.formaPagamentoTaxa,
        billingStrategy: body.billingStrategy,
        multaPercentual: body.multaPercentual ?? null,
        jurosMensal: body.jurosMensal ?? null,
        descontoAntecipado: body.descontoAntecipado ?? null,
        descontoTipo: body.descontoTipo ?? null,
        prazoDesconto: body.prazoDesconto ?? null,
        notificationChannels: [...body.notificationChannels].sort(),
        notificationChannelsConfigured: body.notificationChannelsConfigured,
      }),
    )
    .digest('hex');

  const existingOperation = await prisma.familyEnrollmentOperation.findFirst({
    where: { contaId, uiRequestId: body.uiRequestId },
  });
  const resumableOperation =
    existingOperation?.status === 'PROCESSING' && !existingOperation.result
      ? existingOperation
      : null;
  if (
    resumableOperation &&
    (resumableOperation.previewHash !== body.previewHash ||
      resumableOperation.sourceVersion !== body.sourceVersion ||
      resumableOperation.strategy !== body.billingStrategy.kind ||
      resumableOperation.requestFingerprint !== requestFingerprint)
  ) {
    return jsonError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'A mesma solicitação já foi iniciada com outros dados financeiros.',
    );
  }
  if (existingOperation && !resumableOperation) {
    const stored =
      existingOperation.result && typeof existingOperation.result === 'object'
        ? (existingOperation.result as Record<string, unknown>)
        : {};
    return NextResponse.json(
      {
        ...stored,
        familyId: existingOperation.familyGroupId,
        operationStatus: existingOperation.status,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Um grupo sem operação concluída representa uma tentativa interrompida antes
  // do staging financeiro. Ele é retomado usando os uiRequestIds dos filhos.
  const resumableFamily = await prisma.matriculaFamiliar.findFirst({
    where: { contaId, uiRequestId: body.uiRequestId },
    select: { id: true },
  });

  try {
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: body.responsavelId, contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável familiar não encontrado.');
    }

    const dataInicio = parseDate(body.dataInicio);
    const dataFimContrato = parseDate(body.dataFimContrato);
    const paymentSelection = resolveWizardPaymentSelection({
      formaPagamento: body.formaPagamento,
      formaPagamentoTaxa: body.formaPagamentoTaxa,
    });
    const formaPagamento = paymentSelection.formaPagamento ?? FormaPagamento.BOLETO;
    const formaPagamentoTaxa = paymentSelection.formaPagamentoTaxa ?? formaPagamento;

    const alunos = await prisma.aluno.findMany({
      where: {
        contaId,
        id: { in: body.alunos.map((item) => item.alunoId) },
      },
      select: { id: true, nome: true },
    });

    const requestedAlunoIds = Array.from(new Set(body.alunos.map((item) => item.alunoId)));
    if (alunos.length !== requestedAlunoIds.length) {
      return jsonError(
        404,
        'ALUNO_NAO_ENCONTRADO',
        'Um ou mais alunos familiares não foram encontrados.',
      );
    }

    const unlinkedStudentIds = await findUnlinkedStudentIds(prisma, {
      contaId,
      responsavelId: responsavel.id,
      alunoIds: requestedAlunoIds,
    });
    if (unlinkedStudentIds.length > 0) {
      return jsonError(
        422,
        'ALUNO_NAO_VINCULADO_AO_RESPONSAVEL',
        'Todos os alunos da matrícula familiar precisam estar vinculados ao responsável selecionado.',
        { alunoIds: unlinkedStudentIds },
      );
    }

    const alunoById = new Map(alunos.map((aluno) => [aluno.id, aluno]));
    const pricing = await resolveFamilyPricing({
      contaId,
      modoTurmas: body.modoTurmas,
      planoId: body.planoId,
      alunos: body.alunos,
      descontoIds: body.descontoIds,
    });

    // 2) Validar formas de pagamento ANTES de qualquer escrita: feedback rápido
    //    e sem deixar matrículas órfãs.
    const billingType = paymentSelection.billingType;
    const enrollmentFeeBillingType = paymentSelection.billingTypeTaxa;
    const willCreateSubscriptionPlanned = body.criarCobranca && pricing.totalMensalidade > 0;
    const willCreateEnrollmentFeePlanned =
      !body.taxaIsenta && body.gerarCobrancaTaxa && body.taxaMatricula > 0;

    if (willCreateSubscriptionPlanned && !isSupportedAsaasBillingType(billingType)) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento familiar não suporta cobrança consolidada.',
      );
    }

    if (willCreateEnrollmentFeePlanned && !isSupportedAsaasBillingType(enrollmentFeeBillingType)) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de matrícula não suporta cobrança consolidada.',
      );
    }

    // 2.1) Validar datas ANTES de criar qualquer registro: evita matrículas órfãs
    //      com status FALHO quando o Asaas rejeita por DATA_INVALIDA.
    if (willCreateSubscriptionPlanned) {
      const previewNextDueDate = resolveChargeableFirstDueDate(dataInicio, body.vencimentoDia);
      const previewNextDueDateIso = formatIsoDate(previewNextDueDate);
      const dataFimContratoIso = formatIsoDate(dataFimContrato);
      if (previewNextDueDateIso > dataFimContratoIso) {
        return jsonError(
          422,
          'DATA_FIM_INVALIDA',
          `A data de término do contrato (${dataFimContratoIso}) precisa ser igual ou posterior ao primeiro vencimento (${previewNextDueDateIso}). Ajuste a data de término ou o dia de vencimento.`,
        );
      }
    }

    if (willCreateSubscriptionPlanned || willCreateEnrollmentFeePlanned) {
      const gate = await guardFinancialAccountOr412(contaId);
      if (!gate.ok) return gate.response;

      const payerReadiness = await evaluateResponsavelPayerFiscalReadiness({
        contaId,
        responsavelId: responsavel.id,
      });
      if (!payerReadiness.ready) {
        return jsonError(
          422,
          'RESPONSAVEL_ENDERECO_INCOMPLETO',
          payerReadiness.issues[0]?.message ??
            'Complete o endereço do responsável financeiro antes de gerar cobranças.',
          { responsavelId: responsavel.id },
        );
      }
    }

    const scheduledStrategy =
      body.billingStrategy.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
        ? body.billingStrategy
        : null;
    const scheduleNextCycle = Boolean(scheduledStrategy);
    const scheduledTargetFamily = scheduledStrategy
      ? await prisma.matriculaFamiliar.findFirst({
          where: {
            id: scheduledStrategy.financialGroupId.replace(/^family:/, ''),
            contaId,
            responsavelId: responsavel.id,
            billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
            standaloneSubscriptionId: { not: null },
          },
        })
      : null;
    if (scheduleNextCycle && !scheduledTargetFamily?.standaloneSubscriptionId) {
      return jsonError(
        409,
        'AGRUPAMENTO_FAMILIAR_INDISPONIVEL',
        'O agrupamento familiar de destino não está provisionado para a unificação agendada.',
      );
    }
    const previewExpiresAt = parseDate(body.previewExpiresAt);
    if (previewExpiresAt <= new Date()) {
      return jsonError(409, 'PREVIEW_EXPIRADO', 'O preview expirou. Revise os valores novamente.');
    }
    const familyPreview = await previewInitialEnrollmentBilling(
      {
        contaId,
        enrollmentMode: 'FAMILY',
        familyPricingMode:
          body.modoTurmas === 'TURMAS' ? 'AGGREGATE_PLAN' : 'ITEMIZED_COMBOS',
        aggregateMonthlyAmount: pricing.totalMensalidade,
        aggregateEnrollmentFeeAmount: body.taxaIsenta ? 0 : body.taxaMatricula,
        billingStrategy: body.billingStrategy,
        responsavelFinanceiroId: responsavel.id,
        existingFamilyGroupId:
          body.billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE'
            ? body.billingStrategy.financialGroupId
            : null,
        dataInicio,
        dataFimContrato,
        formaPagamento,
        vencimentoDia: body.vencimentoDia,
        descontoIds: body.descontoIds,
        items: body.alunos.map((item) => ({
          alunoId: item.alunoId,
          turmaId: body.modoTurmas === 'TURMAS' ? item.turmaId ?? null : null,
          comboId: body.modoTurmas === 'COMBO' ? item.comboId ?? null : null,
          planoId: body.modoTurmas === 'TURMAS' ? body.planoId ?? null : null,
          taxaMatricula: body.taxaMatricula,
        })),
      },
      { prisma },
    );
    if (!familyPreview.compatibility.compatible) {
      return jsonError(
        409,
        'PREVIEW_INCOMPATIVEL',
        familyPreview.compatibility.blockers[0]?.message ?? 'Preview familiar incompatível.',
        familyPreview.compatibility.blockers,
      );
    }
    if (
      familyPreview.previewHash !== body.previewHash ||
      familyPreview.sourceVersion !== body.sourceVersion
    ) {
      return jsonError(
        409,
        'PREVIEW_DIVERGENTE',
        'Os dados financeiros mudaram desde a revisão. Gere um novo preview.',
      );
    }

    // 3) Criar um novo grupo ou anexar a uma família provisionada.
    //    Em caso de corrida, o segundo POST cai aqui e reaproveita o registro.
    let family;
    const joinExisting = body.billingStrategy.kind === 'JOIN_EXISTING_CURRENT_CYCLE';
    try {
      if (joinExisting) {
        const targetId =
          'financialGroupId' in body.billingStrategy
            ? body.billingStrategy.financialGroupId.replace(/^family:/, '')
            : '';
        family = await prisma.matriculaFamiliar.findFirst({
          where: {
            id: targetId,
            contaId,
            responsavelId: responsavel.id,
            billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
            standaloneSubscriptionId: { not: null },
          },
        });
        if (!family) {
          return jsonError(
            409,
            'AGRUPAMENTO_FAMILIAR_INDISPONIVEL',
            'O agrupamento familiar não está disponível para receber novos alunos.',
          );
        }
      } else if (resumableFamily) {
        family = await prisma.matriculaFamiliar.findFirstOrThrow({
          where: { id: resumableFamily.id, contaId },
        });
      } else {
        family = await prisma.matriculaFamiliar.create({
          data: {
            contaId,
            responsavelId: responsavel.id,
            billingMode: BillingMode.SHARED_PLAN,
            status: FamilyBillingStatus.PENDENTE,
            academicStatus: FamilyAcademicStatus.PENDENTE,
            billingProvisionStatus: MatriculaBillingProvisionStatus.PENDENTE,
            totalAlunos: new Set(body.alunos.map((item) => item.alunoId)).size,
            valorMensalidadeTotal: pricing.totalMensalidade,
            valorTaxaMatriculaTotal: body.taxaIsenta
              ? 0
              : Number(body.taxaMatricula.toFixed(2)),
            formaPagamento: formaPagamento,
            ciclo: pricing.cycle,
            diaVencimento: body.vencimentoDia,
            dataInicio,
            dataFimContrato,
            actorId: user.id,
            uiRequestId: body.uiRequestId,
          },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await prisma.matriculaFamiliar.findFirst({
          where: { contaId, uiRequestId: body.uiRequestId },
        });
        if (concurrent) {
          family = concurrent;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    if (resumableOperation && resumableOperation.familyGroupId !== family.id) {
      return jsonError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'A solicitação em andamento pertence a outro agrupamento familiar.',
      );
    }
    const reservedPreviousMonthlyAmount = Number(family.valorMensalidadeTotal);
    const reservedAddedMonthlyAmount = body.criarCobranca ? pricing.totalMensalidade : 0;
    const operation = resumableOperation
      ? resumableOperation
      : await prisma.familyEnrollmentOperation.create({
          data: {
            contaId,
            familyGroupId: family.id,
            uiRequestId: body.uiRequestId,
            strategy: body.billingStrategy.kind,
            status: 'PROCESSING',
            previewHash: body.previewHash,
            sourceVersion: body.sourceVersion,
            requestFingerprint,
            expectedBillingVersion: family.billingVersion,
            previousMonthlyAmount: joinExisting ? reservedPreviousMonthlyAmount : 0,
            addedMonthlyAmount: reservedAddedMonthlyAmount,
            resultingMonthlyAmount: joinExisting
              ? Number((reservedPreviousMonthlyAmount + reservedAddedMonthlyAmount).toFixed(2))
              : reservedAddedMonthlyAmount,
            enrollmentFeeAmount:
              !body.taxaIsenta && body.gerarCobrancaTaxa
                ? Number(body.taxaMatricula.toFixed(2))
                : 0,
            actorId: user.id,
          },
        });

    // 4) Criar matrículas individuais (sem cobrança/taxa em cada uma — a cobrança
    //    é consolidada no responsável via createStandaloneCharge).
    const results: FamilyResultItem[] = [];

    const commonInput: Omit<CriarMatriculaInput, 'alunoId' | 'comboId' | 'turmaId'> = {
      contaId,
      responsavelFinanceiroId: responsavel.id,
      planoId: body.modoTurmas === 'TURMAS' ? (body.planoId ?? null) : null,
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
      matriculaFamiliarId: family.id,
      valorMensalidadeOverride: null,
      formaPagamento,
      formaPagamentoTaxa,
      createdById: user.id,
      modeloId: body.modeloId,
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
      const itemId = item.itemId ?? `${aluno.id}:${index}`;

      try {
        const created = await criarMatricula({
          ...commonInput,
          alunoId: aluno.id,
          turmaId: body.modoTurmas === 'TURMAS' ? (item.turmaId ?? null) : null,
          comboId: body.modoTurmas === 'COMBO' ? (item.comboId ?? null) : null,
          uiRequestId: `${body.uiRequestId}:aluno:${aluno.id}:item:${index}`,
          familyOrderIndex: index,
          billingStrategy: { kind: 'SEPARATE' },
        });

        results.push({
          itemId,
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          status: 'success',
          matriculaId: created.matricula.id,
          contratoId: created.contratoId ?? undefined,
        });
      } catch (error) {
        const message =
          error instanceof MatriculaConflictError || error instanceof Error
            ? error.message
            : 'Falha ao criar matrícula familiar.';
        results.push({
          itemId,
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          status: 'error',
          errorMessage: message,
        });
      }
    }

    const successCount = results.filter((result) => result.status === 'success').length;
    const failureCount = results.length - successCount;

    if (successCount === 0) {
      const failureMessage = 'Nenhuma matrícula pôde ser criada no lote familiar.';
      await prisma.$transaction([
        prisma.familyEnrollmentOperation.updateMany({
          where: { id: operation.id, contaId, status: 'PROCESSING' },
          data: {
            status: 'FAILED',
            lastError: failureMessage,
            result: { familyId: family.id, results } as Prisma.InputJsonValue,
          },
        }),
        ...(!joinExisting
          ? [
              prisma.matriculaFamiliar.updateMany({
                where: { id: family.id, contaId },
                data: {
                  status: FamilyBillingStatus.FALHO,
                  academicStatus: FamilyAcademicStatus.FALHO,
                  billingProvisionStatus: MatriculaBillingProvisionStatus.FALHO,
                  ultimoErro: failureMessage,
                },
              }),
            ]
          : []),
      ]);

      return NextResponse.json(
        {
          familyId: family.id,
          status: FamilyBillingStatus.FALHO,
          results,
        },
        { status: 409, headers: { 'cache-control': 'no-store' } },
      );
    }

    // 5) Recalcular valores com base apenas nas matrículas que deram certo
    //    e registrar a composição financeira para provisionamento assíncrono.
    const successfulItems = body.alunos.filter(
      (_item, index) => results[index]?.status === 'success',
    );
    const existingFamilyAlunoIds = joinExisting
      ? await prisma.matriculaFamiliarItem.findMany({
          where: {
            matriculaFamiliarId: family.id,
            matriculaFamiliar: { contaId },
          },
          select: { matricula: { select: { alunoId: true } } },
        })
      : [];
    const resultingAlunoIds = new Set([
      ...existingFamilyAlunoIds.map((item) => item.matricula.alunoId),
      ...successfulItems.map((item) => item.alunoId),
    ]);
    const resultingTotalAlunos = resultingAlunoIds.size;
    const financialPricing = await resolveFamilyPricing({
      contaId,
      modoTurmas: body.modoTurmas,
      planoId: body.planoId,
      alunos: successfulItems,
      descontoIds: body.descontoIds,
    });
    const enrollmentFeeTotal = willCreateEnrollmentFeePlanned
      ? Number(body.taxaMatricula.toFixed(2))
      : 0;
    const subscriptionValue = body.criarCobranca ? financialPricing.totalMensalidade : 0;
    const previousMonthlyAmount = Number(family.valorMensalidadeTotal);
    const resultingMonthlyAmount = joinExisting
      ? Number((previousMonthlyAmount + subscriptionValue).toFixed(2))
      : subscriptionValue;
    await prisma.familyEnrollmentOperation.updateMany({
      where: { id: operation.id, contaId, status: 'PROCESSING' },
      data: {
        previousMonthlyAmount: joinExisting ? previousMonthlyAmount : 0,
        addedMonthlyAmount: subscriptionValue,
        resultingMonthlyAmount,
        enrollmentFeeAmount: enrollmentFeeTotal,
      },
    });

    if (!joinExisting) {
      await prisma.matriculaFamiliar.update({
        where: { id: family.id },
        data: {
          totalAlunos: resultingTotalAlunos,
          valorMensalidadeTotal: subscriptionValue,
          valorTaxaMatriculaTotal: enrollmentFeeTotal,
        },
      });
    }

    const successfulResults = results.filter(
      (result): result is FamilyResultItem & { matriculaId: string } =>
        result.status === 'success' && Boolean(result.matriculaId),
    );
    const subscriptionSplits = allocateFamilyAmount({
      total: subscriptionValue,
      weights: financialPricing.itemWeights,
      method: financialPricing.allocationMethod,
    });
    const subscriptionBaseSplits = allocateFamilyAmount({
      total: financialPricing.totalBaseMensalidade,
      weights: financialPricing.itemBaseWeights,
      method: financialPricing.allocationMethod,
    });
    const enrollmentFeeSplits = allocateFamilyAmount({
      total: enrollmentFeeTotal,
      weights: successfulResults.map(() => 1),
      method: 'EQUAL_SPLIT',
    });
    const allocationRows = successfulResults.flatMap((result, resultIndex) => {
      const base = {
        contaId,
        alunoId: result.alunoId,
        matriculaId: result.matriculaId,
        familyGroupId: family.id,
        familyEnrollmentOperationId: operation.id,
        competenceStart: dataInicio,
        competenceEnd: dataFimContrato,
        metadata: {
          source: 'MATRICULA_FAMILIAR',
          billingMode: 'SHARED_PLAN',
          modeloId: body.modeloId ?? null,
          allocationMethod: financialPricing.allocationMethod,
          formaPagamento,
          vencimentoDia: body.vencimentoDia,
          descontoIds: body.descontoIds,
        } as Prisma.InputJsonValue,
      };
      const rows = [];
      if (subscriptionValue > 0) {
        const amount = subscriptionSplits[resultIndex] ?? 0;
        rows.push({
          ...base,
          chargeKind: 'MENSALIDADE',
          amount,
          baseAmount: subscriptionBaseSplits[resultIndex] ?? amount,
          discountAmount: Number(
            ((subscriptionBaseSplits[resultIndex] ?? amount) - amount).toFixed(2),
          ),
          status: 'PENDING',
          allocationMethod: financialPricing.allocationMethod,
          weight: financialPricing.itemWeights[resultIndex] ?? 1,
        });
      }
      if (enrollmentFeeTotal > 0) {
        const amount = enrollmentFeeSplits[resultIndex] ?? 0;
        rows.push({
          ...base,
          chargeKind: 'TAXA_MATRICULA',
          amount,
          baseAmount: amount,
          discountAmount: 0,
          status: 'PENDING',
          allocationMethod: 'EQUAL_SPLIT' as const,
          weight: 1,
        });
      }
      return rows;
    });

    if (allocationRows.length > 0) {
      await prisma.familyFinancialAllocation.createMany({
        data: allocationRows,
        skipDuplicates: true,
      });
    }

    const shouldCreateSubscription = subscriptionValue > 0;
    const shouldCreateEnrollmentFee = enrollmentFeeTotal > 0;

    let financialStatus: FamilyBillingStatus =
      failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.PENDENTE;
    let financialError: string | null = null;

    if (shouldCreateSubscription || shouldCreateEnrollmentFee) {
      const nextDueDate = resolveChargeableFirstDueDate(dataInicio, body.vencimentoDia);
      const billingAdjustments = buildBillingAdjustments(body);

      const payloadDraft = {
        aggregateType: 'MATRICULA_FAMILIAR' as const,
        aggregateId: family.id,
        contaId,
        responsavelId: responsavel.id,
        responsavelNome: responsavel.nome,
        totalAlunos: resultingTotalAlunos,
        monthlyValue: shouldCreateSubscription ? subscriptionValue : 0,
        enrollmentFeeValue: shouldCreateEnrollmentFee ? enrollmentFeeTotal : 0,
        billingType: billingType ?? enrollmentFeeBillingType ?? null,
        enrollmentFeeBillingType: enrollmentFeeBillingType ?? billingType ?? null,
        cycle: financialPricing.cycle,
        nextDueDate: formatIsoDate(nextDueDate),
        endDate: formatIsoDate(dataFimContrato),
        enrollmentFeeDueDate: formatIsoDate(resolveEnrollmentFeeDueDate(dataInicio)),
        description: `${financialPricing.descricao} · ${responsavel.nome}`,
        actorId: user.id,
        uiRequestId: body.uiRequestId,
        strategy: body.billingStrategy.kind,
        operationId: operation.id,
        targetStandaloneSubscriptionId: joinExisting
          ? family.standaloneSubscriptionId
          : scheduledTargetFamily?.standaloneSubscriptionId ?? null,
        scheduledEffectiveAt: scheduledStrategy?.effectiveAt ?? null,
        expectedBillingVersion: operation.expectedBillingVersion,
        previousMonthlyValue: joinExisting ? previousMonthlyAmount : 0,
        resultingMonthlyValue: resultingMonthlyAmount,
        notificationChannels: body.notificationChannels,
        notificationChannelsConfigured: body.notificationChannelsConfigured,
        discount: billingAdjustments.discount ?? null,
        interest: billingAdjustments.interest ?? null,
        fine: billingAdjustments.fine ?? null,
      } satisfies Record<string, unknown>;

      let payload: FamilyBillingPayload;
      try {
        payload = parseFamilyBillingPayload(payloadDraft);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markFamilyBillingFailed(
          {
            ...(payloadDraft as unknown as FamilyBillingPayload),
          },
          message,
        );
        console.error('[POST /api/matriculas/familiar] Payload financeiro inválido', {
          familyId: family.id,
          message,
        });
        return NextResponse.json(
          {
            familyId: family.id,
            status: FamilyBillingStatus.FALHO,
            results,
            financialError: message,
          },
          { status: 422, headers: { 'cache-control': 'no-store' } },
        );
      }

      try {
        await enqueueFamilyBillingOutbox({
          contaId,
          aggregateType: 'MATRICULA_FAMILIAR',
          aggregateId: family.id,
          matriculaFamiliarId: family.id,
          payload,
          eventType: joinExisting
            ? `JOIN_EXISTING_FAMILY_CURRENT_CYCLE:${operation.id}`
            : scheduleNextCycle
              ? `SCHEDULE_FAMILY_UNIFICATION_NEXT_CYCLE:${operation.id}`
              : `SYNC_FAMILY_BILLING:${operation.id}`,
        });
        financialStatus = failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.PENDENTE;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        financialError = message;
        financialStatus = FamilyBillingStatus.FALHO;
        await markFamilyBillingFailed(payload, message);
        console.error('[POST /api/matriculas/familiar] Falha ao gerar cobrança consolidada', {
          familyId: family.id,
          message,
        });
      }
    } else {
      financialStatus = failureCount > 0 ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.ATIVO;
    }

    const academicStatus =
      failureCount > 0 ? FamilyAcademicStatus.PARCIAL : FamilyAcademicStatus.COMPLETO;
    const billingProvisionStatus =
      shouldCreateSubscription || shouldCreateEnrollmentFee
        ? financialError
          ? joinExisting
            ? MatriculaBillingProvisionStatus.PARCIAL
            : MatriculaBillingProvisionStatus.FALHO
          : joinExisting
            ? MatriculaBillingProvisionStatus.PARCIAL
            : MatriculaBillingProvisionStatus.PENDENTE
        : MatriculaBillingProvisionStatus.NAO_APLICAVEL;
    const operationStatus =
      shouldCreateSubscription || shouldCreateEnrollmentFee
        ? financialError
          ? 'FAILED'
          : 'PENDING'
        : failureCount > 0
          ? 'PARTIAL'
          : 'COMPLETED';
    const responsePayload = {
      familyId: family.id,
      status: joinExisting ? family.status : financialStatus,
      academicStatus,
      billingProvisionStatus,
      paymentStatus:
        shouldCreateEnrollmentFee || shouldCreateSubscription ? 'PENDENTE' : 'SEM_COBRANCA',
      operationId: operation.id,
      operationStatus,
      results,
      modeloId: body.modeloId,
      financialError: financialError
        ? 'Não foi possível concluir o provisionamento financeiro. Atualize o status ou acione o suporte.'
        : null,
    };

    await prisma.$transaction([
      prisma.matriculaFamiliar.updateMany({
        where: { id: family.id, contaId },
        data: {
          academicStatus,
        },
      }),
      prisma.matriculaFamiliar.updateMany({
        where: {
          id: family.id,
          contaId,
          billingProvisionStatus: {
            in: [
              MatriculaBillingProvisionStatus.PENDENTE,
              MatriculaBillingProvisionStatus.PROCESSANDO,
              MatriculaBillingProvisionStatus.PARCIAL,
              MatriculaBillingProvisionStatus.FALHO,
            ],
          },
        },
        data: {
          ...(joinExisting ? {} : { status: financialStatus }),
          ...(joinExisting && !shouldCreateSubscription && !shouldCreateEnrollmentFee
            ? { totalAlunos: family.totalAlunos + successCount }
            : {}),
          billingProvisionStatus,
          ultimoErro: financialError,
        },
      }),
      prisma.familyEnrollmentOperation.updateMany({
        where: {
          id: operation.id,
          contaId,
          status: { in: ['PROCESSING', 'PENDING'] },
        },
        data: {
          status: operationStatus,
          result: responsePayload as Prisma.InputJsonValue,
          lastError: financialError,
          completedAt:
            !shouldCreateSubscription && !shouldCreateEnrollmentFee ? new Date() : null,
        },
      }),
    ]);

    return NextResponse.json(
      responsePayload,
      { status: 202, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[POST /api/matriculas/familiar]', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrentOperation = await prisma.familyEnrollmentOperation.findFirst({
        where: { contaId, uiRequestId: body.uiRequestId },
        select: { familyGroupId: true, status: true, result: true },
      });
      if (concurrentOperation) {
        return NextResponse.json(
          {
            ...(concurrentOperation.result && typeof concurrentOperation.result === 'object'
              ? (concurrentOperation.result as Record<string, unknown>)
              : {}),
            familyId: concurrentOperation.familyGroupId,
            operationStatus: concurrentOperation.status,
          },
          { status: 200, headers: { 'cache-control': 'no-store' } },
        );
      }
      return jsonError(
        409,
        'OPERACAO_FAMILIAR_EM_ANDAMENTO',
        'Já existe uma alteração financeira em andamento para este agrupamento familiar.',
      );
    }
    return jsonError(
      error instanceof MatriculaConflictError ? 409 : 500,
      'ERRO_MATRICULA_FAMILIAR',
      error instanceof Error ? error.message : 'Erro ao criar matrícula familiar.',
    );
  }
}
