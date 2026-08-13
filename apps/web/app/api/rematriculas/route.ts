import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { type RematriculaElegivelItem } from '@/src/server/matriculas/rematricula.service';
import {
  confirmRenewalProcess,
  previewRenewalProcess,
} from '@/src/server/matriculas/renewal-process.service';
import { listRenewalManagement } from '@/src/server/matriculas/renewal-management.service';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { prisma } from '@/src/prisma';
import { FormaPagamento, Prisma, StatusContrato } from '@prisma/client';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  createRematriculaInputDTOSchema,
  createRematriculaResultDTOSchema,
  listRematriculasQueryDTOSchema,
} from '@/features/cadastro/rematriculas/dtos';
import {
  mapCreateRematriculaResultToDTO,
  mapListRematriculasResultToDTO,
} from '@/features/cadastro/rematriculas/mappers';
import {
  buildFinancialSnapshot,
  evaluateCanonicalRematriculaDecision,
  serializeFinancialSnapshot,
} from '@/src/server/matriculas/rematricula-financial-policy.service';
import {
  isSupportedAsaasBillingType,
  resolveWizardPaymentSelection,
} from '@/src/server/matriculas/payment-selection';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
};

async function resolveAuthContext(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = user?.contaId?.trim() || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId, session, user };
  }
  return {
    contaId: requested || sessionContaId,
    mismatch: false,
    sessionContaId,
    session,
    user,
  };
}

async function loadRematriculaDecision(params: {
  contaId: string;
  matriculaId: string;
}) {
  const matricula = await prisma.matricula.findFirst({
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
  });

  if (!matricula) {
    return null;
  }

  const diasRestantes = Math.ceil(
    (matricula.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const contratoExpirado = diasRestantes < 0;
  const academicEligible = validarElegibilidadeRematricula({
    status: matricula.status,
    contratoExpirado,
    diasContratoExpirado: contratoExpirado ? Math.abs(diasRestantes) : 0,
  }).success;

  const financialSnapshot = buildFinancialSnapshot({
    cobrancas: matricula.cobrancas,
    statusFinanceiro: matricula.statusFinanceiro,
    integrationStatus: matricula.integrationStatus,
    debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
  });

  const decision = evaluateCanonicalRematriculaDecision({
    academicEligible,
    financialSnapshot,
  });

  return { financialSnapshot, decision, academicEligible };
}

async function auditBlockedAttempt(params: {
  matriculaId: string;
  actorId: string;
  policySnapshot: Prisma.JsonObject;
  financialSnapshot: ReturnType<typeof serializeFinancialSnapshot>;
  reason: string;
  decisionMessage: string;
  overrideReason?: string;
}) {
  await prisma.matriculaLog.create({
    data: {
      matriculaId: params.matriculaId,
      actorId: params.actorId,
      action: 'REMATRICULA_TENTATIVA_BLOQUEADA',
      metadata: {
        reason: params.reason,
        decisionMessage: params.decisionMessage,
        policySnapshot: params.policySnapshot,
        financialSnapshot: params.financialSnapshot,
        overrideReason: params.overrideReason ?? null,
      },
    },
  });
}

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length) {
    const n = Number(value.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseInteger(value: unknown) {
  const parsed = parseNumber(value);
  return parsed !== undefined ? Math.trunc(parsed) : undefined;
}

function normalizeRematriculaBillingMode(value: unknown) {
  if (value === 'SHARED_PLAN') return 'SHARED_PLAN';
  if (value === 'INDIVIDUAL') return 'INDIVIDUAL';
  return undefined;
}

function toDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim().length) {
    const trimmed = value.trim();
    const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (!Number.isNaN(date.getTime())) return date;
    }

    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function toRematriculaPaymentMethod(
  value: FormaPagamento | undefined,
): 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | undefined {
  if (value === FormaPagamento.BOLETO) return 'BOLETO';
  if (value === FormaPagamento.PIX) return 'PIX';
  if (value === FormaPagamento.CARTAO_CREDITO) return 'CARTAO_CREDITO';
  return undefined;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildLegacyRenewalIdempotencyKey(input: {
  contaId: string;
  matriculaId: string;
  targetPeriodId: string;
  effectiveAt: Date;
  planId?: string | null;
  targetId?: string | null;
}) {
  return [
    'renewal',
    input.contaId,
    input.matriculaId,
    input.targetPeriodId,
    dateKey(input.effectiveAt),
    input.planId ?? 'plan-source',
    input.targetId ?? 'target-source',
  ].join(':');
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const auth = await resolveAuthContext(url.searchParams.get('contaId'));

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (!auth.user?.id || !auth.user.role || !allowedRoles.has(auth.user.role.toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        'Usuário não tem permissão para consultar rematrículas.',
      );
    }

    const queryDTO = listRematriculasQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId') ?? undefined,
      diasAntecedencia: Number(url.searchParams.get('diasAntecedencia') ?? '60'),
      referencia: url.searchParams.get('referencia') ?? undefined,
      statusContrato: url.searchParams.get('statusContrato') ?? undefined,
      targetPeriodId: url.searchParams.get('targetPeriodId') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    const dias = queryDTO.diasAntecedencia;
    const referenciaParam = queryDTO.referencia;
    const statusContratoParam = queryDTO.statusContrato;
    const statusContratoValue =
      statusContratoParam &&
      Object.values(StatusContrato).includes(statusContratoParam as StatusContrato)
        ? (statusContratoParam as StatusContrato)
        : undefined;

    const management = await listRenewalManagement({
      contaId: auth.contaId,
      diasAntecedencia: Number.isFinite(dias) ? dias : 60,
      referencia: referenciaParam ? toDate(referenciaParam) : undefined,
      statusContrato: statusContratoValue,
      targetPeriodId: queryDTO.targetPeriodId,
      search: url.searchParams.get('q') ?? url.searchParams.get('search') ?? undefined,
      currentUserRole: auth.user.role,
      campaignId: url.searchParams.get('campaignId') ?? undefined,
      processStatus: url.searchParams.get('processStatus') ?? undefined,
    }, { prisma });
    const result = management.eligible;

    const itens = result.itens.map((item: RematriculaElegivelItem) => ({
      id: item.id,
      status: item.status,
      statusContrato: item.statusContrato,
      matriculaFamiliarId: item.matriculaFamiliarId,
      dataInicio: item.dataInicio.toISOString(),
      dataFimContrato: item.dataFimContrato.toISOString(),
      diasRestantes: item.diasRestantes,
      contratoExpirado: item.contratoExpirado,
      podeRenovar: item.podeRenovar,
      eligibilityStatus: item.eligibilityStatus,
      aluno: item.aluno,
      responsavelFinanceiro: item.responsavelFinanceiro,
      plano: item.plano,
      turma: item.turma,
      combo: item.combo,
      financeiro: item.financeiro,
    }));

    const legacyPayload = mapListRematriculasResultToDTO({
        referencia: result.referencia.toISOString(),
        ate: result.ate.toISOString(),
        total: result.total,
        itens,
      });

    return NextResponse.json(
      {
        ...legacyPayload,
        campaigns: management.campaigns,
        participants: management.participants,
        processes: management.processes,
        history: management.history,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[API Rematrículas] Erro ao listar:', error);
    return jsonError(500, 'ERRO_LISTAR_REMATRICULAS', (error as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido');
    }
    const body = createRematriculaInputDTOSchema.parse(rawBody);

    const auth = await resolveAuthContext(body.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (!auth.user?.id || !auth.user.role || !allowedRoles.has(auth.user.role.toUpperCase())) {
      return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para rematricular.');
    }

    const paymentSelection = resolveWizardPaymentSelection({
      formaPagamento: body.formaPagamento,
      formaPagamentoTaxa: body.formaPagamentoTaxa,
    });

    if (paymentSelection.invalidFormaPagamento) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento da rematrícula é inválida.',
      );
    }

    if (paymentSelection.invalidFormaPagamentoTaxa) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de rematrícula é inválida.',
      );
    }

    const matriculaId = body.matriculaId;
    if (!matriculaId) {
      return jsonError(400, 'MATRICULA_OBRIGATORIA', 'matriculaId é obrigatório.');
    }

    const dataInicioValue = toDate(body.dataInicio) ?? new Date();
    const dataFimContratoValue = toDate(body.dataFimContrato);
    if (!dataFimContratoValue) {
      return jsonError(400, 'DATA_FIM_CONTRATO_OBRIGATORIA', 'dataFimContrato é obrigatório.');
    }

    // Converter formaPagamento para o formato esperado pelo use case. A validação
    // acontece antes das leituras de política para falhar sem qualquer efeito colateral.
    if (
      paymentSelection.formaPagamento &&
      !isSupportedAsaasBillingType(paymentSelection.billingType)
    ) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento da rematrícula não suporta cobrança no Asaas.',
      );
    }

    if (
      paymentSelection.formaPagamentoTaxa &&
      !isSupportedAsaasBillingType(paymentSelection.billingTypeTaxa)
    ) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de rematrícula não suporta cobrança no Asaas.',
      );
    }

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const rematriculaDecision = await loadRematriculaDecision({
      contaId: auth.contaId,
      matriculaId,
    });

    if (!rematriculaDecision) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');
    }

    const policySnapshot = {
      policy: 'ALUSA_CANONICAL_RENEWAL_FLOW',
      version: 1,
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
      financialPendingBehavior: 'RESERVA_VAGA_E_SEGURA_FINANCEIRO_FUTURO',
    } satisfies Prisma.JsonObject;
    const financialSnapshot = serializeFinancialSnapshot(rematriculaDecision.financialSnapshot);
    const overrideReason =
      typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '';

    if (rematriculaDecision.decision.actionStatus === 'BLOQUEADA') {
      await auditBlockedAttempt({
        matriculaId,
        actorId: auth.user.id,
        policySnapshot,
        financialSnapshot,
        reason: rematriculaDecision.decision.blockReason,
        decisionMessage: rematriculaDecision.decision.message,
      });

      return jsonError(409, 'REMATRICULA_BLOQUEADA', rematriculaDecision.decision.message, {
        actionStatus: rematriculaDecision.decision.actionStatus,
        blockReason: rematriculaDecision.decision.blockReason,
      });
    }

    if (rematriculaDecision.decision.actionStatus === 'REQUER_OVERRIDE') {
      if (!rematriculaDecision.decision.canCurrentUserOverride) {
        await auditBlockedAttempt({
          matriculaId,
          actorId: auth.user.id,
          policySnapshot,
          financialSnapshot,
          reason: 'OVERRIDE_SEM_PERMISSAO',
          decisionMessage: rematriculaDecision.decision.message,
          overrideReason,
        });

        return jsonError(
          403,
          'OVERRIDE_SEM_PERMISSAO',
          'Seu perfil não pode autorizar esta rematrícula.',
        );
      }

      if (rematriculaDecision.decision.requiresOverrideReason && !overrideReason) {
        await auditBlockedAttempt({
          matriculaId,
          actorId: auth.user.id,
          policySnapshot,
          financialSnapshot,
          reason: 'OVERRIDE_MOTIVO_OBRIGATORIO',
          decisionMessage: rematriculaDecision.decision.message,
        });

        return jsonError(
          422,
          'OVERRIDE_MOTIVO_OBRIGATORIO',
          'Informe o motivo da autorização administrativa.',
        );
      }
    }

    const formaPagamento = toRematriculaPaymentMethod(paymentSelection.formaPagamento);
    const formaPagamentoTaxa = toRematriculaPaymentMethod(paymentSelection.formaPagamentoTaxa);
    const origem = await prisma.matricula.findFirst({
      where: { id: matriculaId, aluno: { contaId: auth.contaId } },
      select: {
        id: true,
        alunoId: true,
        responsavelFinanceiroId: true,
        turmaId: true,
        planoId: true,
        comboId: true,
        dataInicio: true,
        dataFimContrato: true,
      },
    });

    if (!origem) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada.');
    }

    if (body.responsavelFinanceiroId && body.responsavelFinanceiroId !== origem.responsavelFinanceiroId) {
      const novoResponsavel = await prisma.responsavel.findFirst({
        where: { id: body.responsavelFinanceiroId, contaId: auth.contaId },
        select: { id: true },
      });
      if (!novoResponsavel) {
        return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável financeiro não encontrado.');
      }

      const vinculo = await prisma.alunoResponsavel.findFirst({
        where: {
          contaId: auth.contaId,
          alunoId: origem.alunoId,
          responsavelId: body.responsavelFinanceiroId,
        },
        select: { id: true },
      });
      if (!vinculo) {
        return jsonError(
          422,
          'RESPONSAVEL_NAO_VINCULADO',
          'O novo responsável não está vinculado ao aluno.',
        );
      }
    }

    const targetPeriodId = body.targetPeriodId ?? String(dataInicioValue.getUTCFullYear());
    const campaignId = body.campaignId?.trim() || null;
    if (campaignId) {
      const campaign = await prisma.rematriculaCampanha.findFirst({
        where: { id: campaignId, contaId: auth.contaId, targetPeriodId },
        select: { id: true },
      });
      if (!campaign) {
        return jsonError(404, 'CAMPANHA_NAO_ENCONTRADA', 'Campanha não encontrada para este período.');
      }
    }
    const targetComboId = body.comboId ?? null;
    const targetClassId = targetComboId ? null : body.turmaId ?? origem.turmaId;
    const targetPlanId = body.planoId ?? origem.planoId;

    if (!targetPlanId) {
      return jsonError(422, 'PLANO_DESTINO_OBRIGATORIO', 'Selecione o plano do próximo ciclo.');
    }

    if (!targetComboId && !targetClassId) {
      return jsonError(422, 'DESTINO_OBRIGATORIO', 'Selecione a turma ou combo do próximo ciclo.');
    }

    const holderId = body.responsavelFinanceiroId ?? origem.responsavelFinanceiroId ?? origem.alunoId;
    const holderType = body.responsavelFinanceiroId ?? origem.responsavelFinanceiroId ? 'RESPONSIBLE' : 'STUDENT';
    const renewalInput = {
      contaId: auth.contaId,
      actorId: auth.user.id,
      origin: campaignId ? ('CAMPAIGN' as const) : ('STANDALONE' as const),
      campaignId,
      targetPeriodId,
      targetPeriodStartsAt: dataInicioValue,
      holderType: holderType as 'RESPONSIBLE' | 'STUDENT',
      holderId,
      sourceHolderId: origem.responsavelFinanceiroId,
      futureBillingStrategy: body.futureBillingStrategy,
      descontos: body.descontos,
      contractModelId: body.contractModelId ?? null,
      items: [
        {
          decision: 'RENEW' as const,
          sourceEnrollmentId: matriculaId,
          target: targetComboId
            ? { type: 'COMBO' as const, targetId: targetComboId, planId: targetPlanId }
            : { type: 'CLASS' as const, targetId: targetClassId!, planId: targetPlanId },
        },
      ],
      effectiveAt: dataInicioValue,
      firstDueDate: undefined,
      targetContractEndsAt: dataFimContratoValue,
      financialTerms: {
        paymentMethod: formaPagamento,
        enrollmentFeePaymentMethod: formaPagamentoTaxa,
        dueDay: parseInteger(body.vencimentoDia),
        enrollmentFeeAmount: parseNumber(body.taxaMatricula),
        enrollmentFeeExempt: body.taxaIsenta === true || body.taxaIsenta === 'true',
        feeChargeMoment: 'CHARGE_ON_START' as const,
        feeUnit: 'PER_STUDENT' as const,
        feePurpose: 'ADMINISTRATIVE_FEE' as const,
        earlyDiscountPercent: parseNumber(body.descontoAntecipado),
        earlyDiscountDays: parseInteger(body.prazoDesconto),
      },
    };

    const preview = await previewRenewalProcess(renewalInput, { prisma });
    if (preview.blockers.length > 0) {
      return jsonError(422, 'PREVIEW_BLOQUEADO', preview.blockers[0]?.message ?? 'Preview bloqueado.', {
        blockers: preview.blockers,
        warnings: preview.warnings,
      });
    }

    const confirmation = await confirmRenewalProcess(
      {
        ...renewalInput,
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
        idempotencyKey: buildLegacyRenewalIdempotencyKey({
          contaId: auth.contaId,
          matriculaId,
          targetPeriodId,
          effectiveAt: dataInicioValue,
          planId: targetPlanId,
          targetId: targetComboId ?? targetClassId,
        }),
      },
      { prisma },
    );

    const itemConfirmado = await prisma.rematriculaItem.findFirst({
      where: {
        contaId: auth.contaId,
        processoId: confirmation.processId,
        matriculaOrigemId: matriculaId,
      },
      select: { matriculaFuturaId: true },
    });

    const novaMatricula = itemConfirmado?.matriculaFuturaId
      ? await prisma.matricula.findFirst({
          where: { id: itemConfirmado.matriculaFuturaId, aluno: { contaId: auth.contaId } },
          select: {
            id: true,
            planoId: true,
            turmaId: true,
            status: true,
            statusContrato: true,
            dataInicio: true,
            dataFimContrato: true,
            asaasSubscriptionId: true,
            vencimentoDia: true,
            responsavelFinanceiro: {
              select: {
                id: true,
                nome: true,
                cpf: true,
              },
            },
          },
        })
      : null;

    const matriculaAnterior = await prisma.matricula.findFirst({
      where: { id: matriculaId, aluno: { contaId: auth.contaId } },
      select: {
        dataInicio: true,
        dataFimContrato: true,
        turmaId: true,
        planoId: true,
      },
    });

    const primeiroVencimento = preview.firstDueDate
      ? new Date(`${preview.firstDueDate}T00:00:00.000Z`).toISOString()
      : dataInicioValue.toISOString();

    return NextResponse.json(
      createRematriculaResultDTOSchema.parse(
        mapCreateRematriculaResultToDTO({
          operationId: confirmation.processId,
          status: 'PENDING',
          matriculaId: novaMatricula?.id ?? matriculaId,
          message: 'Rematrícula confirmada. O próximo ciclo foi preparado e aguardará a data de início.',
          novaMatricula: {
            id: novaMatricula?.id ?? matriculaId,
            planoId: novaMatricula?.planoId ?? targetPlanId,
            turmaId: novaMatricula?.turmaId ?? targetClassId,
            status: novaMatricula?.status ?? 'AGUARDANDO_CONFIRMACAO',
            statusContrato: novaMatricula?.statusContrato ?? 'AGUARDANDO_ASSINATURA',
            dataInicio: novaMatricula?.dataInicio?.toISOString() ?? dataInicioValue.toISOString(),
            dataFimContrato:
              novaMatricula?.dataFimContrato?.toISOString() ?? dataFimContratoValue.toISOString(),
            asaasSubscriptionId: novaMatricula?.asaasSubscriptionId ?? null,
          },
          historicoContrato: {
            dataInicioAnterior: matriculaAnterior?.dataInicio?.toISOString() ?? '',
            dataFimContratoAnterior: matriculaAnterior?.dataFimContrato?.toISOString() ?? '',
            turmaIdAnterior: matriculaAnterior?.turmaId ?? null,
            planoIdAnterior: matriculaAnterior?.planoId ?? '',
          },
          primeiroVencimento,
          responsavelFinanceiro: novaMatricula?.responsavelFinanceiro
            ? {
                id: novaMatricula.responsavelFinanceiro.id,
                nome: novaMatricula.responsavelFinanceiro.nome,
                cpf: novaMatricula.responsavelFinanceiro.cpf,
              }
            : null,
        }),
      ),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[API Rematrículas] Erro ao criar:', error);
    if ((error as { name?: string }).name === 'ZodError') {
      const zodError = error as { issues?: Array<{ path: string[]; message: string }> };
      const issues = zodError.issues || [];
      const firstIssue = issues[0];
      const message = firstIssue
        ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
        : 'Erro de validação';
      return jsonError(422, 'ERRO_VALIDACAO', message, { issues });
    }
    return jsonError(500, 'ERRO_CRIAR_REMATRICULA', (error as Error).message);
  }
}
