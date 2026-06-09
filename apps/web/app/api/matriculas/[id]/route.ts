import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSubscription, updateSubscription } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  atualizarDetalhesMatricula,
  atualizarStatusMatricula,
  buscarMatriculaPorId,
} from '@/src/server/matriculas/matricula.service';
import { ManualSyncError, syncMatriculaStatus } from '@/src/server/matriculas/matricula-sync.service';
import { updateMatriculaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import {
  mapMatriculaDeleteResultToDTO,
  mapMatriculaRecordToCoreDTO,
  mapMatriculaRecordToResumoDTO,
} from '@/features/cadastro/matriculas/mappers';
import {
  deriveLocalAssinaturaSnapshot,
  type AssinaturaSnapshot,
} from '@/src/server/matriculas/subscription-snapshot';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { alignLocalPendingEnrollmentCharges } from '@/src/server/matriculas/enrollment-finance-consistency.service';
import {
  resolveMatriculaFinancialContext,
  updateFamilyFinancialLocalState,
} from '@/src/server/matriculas/financial-context.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string | null;
  contaId?: string | null;
};

function mapFamilyChargeStatus(status: string) {
  const map: Record<string, string> = {
    CREATED: 'PENDENTE',
    OPEN: 'PENDENTE',
    OVERDUE: 'ATRASADO',
    PAID: 'PAGO',
    CANCELED: 'CANCELADO',
    REFUNDED: 'ESTORNADO',
  };
  return map[status] ?? 'PENDENTE';
}

function mapFamilyBillingType(billingType?: string | null) {
  if (billingType === 'CREDIT_CARD') return 'CARTAO_CREDITO';
  if (billingType === 'DEBIT_CARD') return 'CARTAO';
  if (billingType === 'BOLETO' || billingType === 'PIX') return billingType;
  return 'INDEFINIDO';
}

async function loadFamilyEnrollmentCharge(params: {
  contaId: string;
  matricula: Record<string, unknown>;
}) {
  const family =
    (params.matricula.matriculaFamiliar as { id?: string; standaloneEnrollmentChargeId?: string | null } | null) ??
    null;
  const familyId =
    typeof params.matricula.matriculaFamiliarId === 'string'
      ? params.matricula.matriculaFamiliarId
      : family?.id;
  const chargeId = family?.standaloneEnrollmentChargeId ?? null;

  if (!familyId || !chargeId) return null;

  const charge = await prisma.charge.findFirst({
    where: {
      id: chargeId,
      contaId: params.contaId,
      familyGroupId: familyId,
    },
    select: {
      id: true,
      status: true,
      value: true,
      dueDate: true,
      billingType: true,
      description: true,
      asaasPaymentId: true,
      createdAt: true,
    },
  });

  if (!charge) return null;

  const dueDate = charge.dueDate ?? charge.createdAt;
  return {
    id: charge.id,
    valor: Number(charge.value ?? 0),
    status: mapFamilyChargeStatus(charge.status),
    formaPagamento: mapFamilyBillingType(charge.billingType),
    tipo: 'TAXA_MATRICULA',
    vencimento: dueDate,
    descricao: charge.description ?? 'Taxa de matrícula familiar',
    asaasPaymentId: charge.asaasPaymentId ?? null,
    asaasId: charge.asaasPaymentId ?? null,
    createdAt: charge.createdAt,
    competenciaInicio: dueDate,
    competenciaFim: dueDate,
    dataPagamento: null,
    origin: 'STANDALONE',
  };
}

function normalizeBillingDay(day: number) {
  return Math.min(28, Math.max(1, day));
}

function computeNextDueDate(currentNextDueDate: string, billingDay: number) {
  const base = new Date(`${currentNextDueDate}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error('O vínculo recorrente retornou uma data de próximo vencimento inválida.');
  }

  const candidate = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), normalizeBillingDay(billingDay), 12),
  );

  if (candidate < base) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }

  return candidate.toISOString().slice(0, 10);
}

function formatAsaasDate(date: string | Date) {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Data inválida para sincronização financeira.');
  }
  return parsed.toISOString().slice(0, 10);
}

function compareAsaasDates(left: string, right: string) {
  return new Date(`${left}T12:00:00.000Z`).getTime() - new Date(`${right}T12:00:00.000Z`).getTime();
}

function formatPtBrDateOnly(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString('pt-BR');
}

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUser = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = sessionUser?.contaId || null;
  const sessionUserId = sessionUser?.id || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId, sessionUserId };
  }
  return {
    contaId: requested || sessionContaId,
    mismatch: false,
    sessionContaId,
    sessionUserId,
  };
}

type HardDeleteCheck = {
  ok: boolean;
  details: {
    cobrancas: number;
    cobrancasPorStatus: Record<string, number>;
    pagamentos: number;
    subscriptions: number;
    installmentPlans: number;
    contratoComAceite: number;
    asaasSubscriptionId: string | null;
  };
};

async function canHardDeleteMatricula(
  matriculaId: string,
  contaId: string,
): Promise<HardDeleteCheck | null> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: { id: true, asaasSubscriptionId: true },
  });
  if (!matricula) return null;

  const [cobrancas, pagamentos, subscriptions, installmentPlans, contratoComAceite] =
    await Promise.all([
      prisma.cobranca.count({ where: { matriculaId } }),
      prisma.pagamento.count({ where: { cobranca: { matriculaId } } }),
      prisma.subscription.count({ where: { matriculaId } }),
      prisma.installmentPlan.count({ where: { matriculaId } }),
      prisma.contrato.count({
        where: {
          matriculaId,
          OR: [
            { status: 'ASSINADO' },
            { assinadoEm: { not: null } },
            { assinadoCpf: { not: null } },
            { assinadoEmail: { not: null } },
            { assinadoPor: { not: null } },
            { hashAssinatura: { not: null } },
          ],
        },
      }),
    ]);

  const cobrancasPorStatusRaw = await prisma.cobranca.groupBy({
    by: ['status'],
    where: { matriculaId },
    _count: { status: true },
  });

  const cobrancasPorStatus = cobrancasPorStatusRaw.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = item._count.status;
    return acc;
  }, {});

  const details = {
    cobrancas,
    cobrancasPorStatus,
    pagamentos,
    subscriptions,
    installmentPlans,
    contratoComAceite,
    asaasSubscriptionId: matricula.asaasSubscriptionId ?? null,
  };

  const ok =
    cobrancas === 0 &&
    pagamentos === 0 &&
    subscriptions === 0 &&
    installmentPlans === 0 &&
    contratoComAceite === 0 &&
    !matricula.asaasSubscriptionId;

  return { ok, details };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const contaCtx = await resolveContaId(null);
    if (!contaCtx.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    const forceRefresh = new URL(req.url).searchParams.get('fresh') === '1';

    const matricula = await buscarMatriculaPorId({
      id: ctxParams.id,
      contaId: contaCtx.contaId,
    });

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    let assinaturaSnapshot: AssinaturaSnapshot | null = null;
    const financialContext = await resolveMatriculaFinancialContext({
      db: prisma,
      matriculaId: matricula.id,
      contaId: contaCtx.contaId,
    });
    const targetSubscriptionId =
      financialContext?.asaasSubscriptionId ?? matricula.asaasSubscriptionId ?? null;

    if (targetSubscriptionId) {
      const localSubscription = await prisma.subscription.findFirst({
        where: {
          contaId: contaCtx.contaId,
          matriculaId: matricula.id,
        },
        select: {
          status: true,
          updatedAt: true,
        },
      });
      const localSnapshot = deriveLocalAssinaturaSnapshot(
        matricula as unknown as Record<string, unknown>,
        localSubscription,
      );
      const resolvedLocalSnapshot =
        financialContext?.mode === 'FAMILY'
          ? financialContext.localSnapshot
          : localSnapshot;

      if (forceRefresh) {
        recordAsaasReadDecision('matricula_detail', 'fresh_remote');
        try {
          const remote = await getSubscription(targetSubscriptionId, { contaId: contaCtx.contaId });
          assinaturaSnapshot = {
            asaasSubscriptionId: remote.id,
            status: remote.status,
            billingType: remote.billingType ?? null,
            value: typeof remote.value === 'number' ? remote.value : null,
            nextDueDate: remote.nextDueDate ?? null,
            deleted: Boolean(remote.deleted),
            syncError: null,
            syncedAt: new Date().toISOString(),
          };
        } catch (error) {
          assinaturaSnapshot = {
            asaasSubscriptionId: targetSubscriptionId,
            status: resolvedLocalSnapshot?.status ?? 'ACTIVE',
            billingType: resolvedLocalSnapshot?.billingType ?? null,
            value: resolvedLocalSnapshot?.value ?? null,
            nextDueDate: resolvedLocalSnapshot?.nextDueDate ?? null,
            deleted: resolvedLocalSnapshot?.deleted ?? false,
            syncError: (error as Error).message,
            syncedAt: new Date().toISOString(),
          };
        }
      } else {
        recordAsaasReadDecision('matricula_detail', 'local');
        assinaturaSnapshot = resolvedLocalSnapshot;
      }
    }

    const familyEnrollmentCharge = await loadFamilyEnrollmentCharge({
      contaId: contaCtx.contaId,
      matricula: matricula as unknown as Record<string, unknown>,
    });

    const mappedMatricula = {
      ...(matricula as unknown as Record<string, unknown>),
      asaasSubscriptionId: targetSubscriptionId,
      cobrancas: familyEnrollmentCharge
        ? [familyEnrollmentCharge, ...((matricula.cobrancas ?? []) as unknown[])]
        : matricula.cobrancas,
      assinaturaSnapshot,
      financialContext: financialContext
        ? {
            mode: financialContext.mode,
            sourceMatriculaId: financialContext.sourceMatriculaId,
            targetMatriculaId: financialContext.targetMatriculaId,
            familyGroupId: financialContext.family?.id ?? null,
            responsavelFinanceiro: financialContext.family?.responsavel ?? null,
            affectedMatriculaIds: financialContext.family?.affectedMatriculaIds ?? [matricula.id],
            alunos: financialContext.family?.alunos ?? [
              {
                matriculaId: matricula.id,
                alunoId: matricula.aluno.id,
                nome: matricula.aluno.nome,
              },
            ],
          }
        : null,
    };

    return NextResponse.json(
      {
        matricula: mapMatriculaRecordToResumoDTO(mappedMatricula),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro ao buscar matrícula:', error);
    return jsonError(500, 'ERRO_BUSCAR_MATRICULA', (error as Error).message);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const json = await req.json().catch(() => null);
    const parsedBody = updateMatriculaInputDTOSchema.safeParse(json);
    if (!parsedBody.success) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsedBody.error.issues[0]?.message ?? 'Payload inválido',
        parsedBody.error.issues,
      );
    }

    const contaCtx = await resolveContaId(parsedBody.data.contaId ?? null);
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!contaCtx.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }

    if (parsedBody.data.status) {
      if (parsedBody.data.dataInicio || parsedBody.data.dataFimContrato || parsedBody.data.vencimentoDia) {
        return jsonError(
          422,
          'PAYLOAD_INVALIDO',
          'Atualização de status não pode ser enviada junto com edição de datas ou vencimento.',
        );
      }

      const matricula = await atualizarStatusMatricula({
        id: ctxParams.id,
        contaId: contaCtx.contaId,
        status: parsedBody.data.status,
      });

      if (!matricula) {
        return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
      }

      return NextResponse.json(
        {
          data: mapMatriculaRecordToCoreDTO(matricula as unknown as Record<string, unknown>),
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (!contaCtx.sessionUserId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const before = await prisma.matricula.findFirst({
      where: { id: ctxParams.id, aluno: { contaId: contaCtx.contaId } },
      select: {
        id: true,
        asaasSubscriptionId: true,
        dataFimContrato: true,
        vencimentoDia: true,
        formaPagamento: true,
        formaPagamentoTaxa: true,
        updatedAt: true,
        plano: { select: { valor: true } },
        combo: { select: { valor: true } },
        cobrancas: {
          select: {
            tipo: true,
            status: true,
            formaPagamento: true,
            valor: true,
            vencimento: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!before) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
    }

    let subscriptionMetadata: Record<string, unknown> | undefined;
    let pendingLocalAlignment:
      | {
          matriculaId: string;
          contaId: string;
          dueDate: string;
        }
      | null = null;
    let pendingFamilyLocalUpdate:
      | {
          nextDueDate?: string;
          endDate?: string;
        }
      | null = null;
    const billingDayChanged =
      typeof parsedBody.data.vencimentoDia === 'number' &&
      parsedBody.data.vencimentoDia !== before.vencimentoDia;
    const contractEndDateChanged =
      typeof parsedBody.data.dataFimContrato === 'string' &&
      formatAsaasDate(parsedBody.data.dataFimContrato) !== formatAsaasDate(before.dataFimContrato);

    const financialContext = await resolveMatriculaFinancialContext({
      db: prisma,
      matriculaId: before.id,
      contaId: contaCtx.contaId,
    });
    const targetSubscriptionId =
      financialContext?.asaasSubscriptionId ?? before.asaasSubscriptionId ?? null;

    if (
      contractEndDateChanged &&
      parsedBody.data.dataFimContrato &&
      financialContext?.mode === 'FAMILY' &&
      financialContext.family
    ) {
      const nextEndDate = new Date(parsedBody.data.dataFimContrato);
      const affectedStarts = await prisma.matricula.findMany({
        where: {
          contaId: contaCtx.contaId,
          id: { in: financialContext.family.affectedMatriculaIds },
        },
        select: {
          id: true,
          dataInicio: true,
          aluno: { select: { nome: true } },
        },
      });
      const invalidStart = affectedStarts.find((item) => item.dataInicio > nextEndDate);
      if (invalidStart) {
        return jsonError(
          422,
          'DATA_FIM_FAMILIAR_INVALIDA',
          `Data de fim familiar deve ser posterior à data de início de ${invalidStart.aluno.nome}.`,
        );
      }
    }

    if ((billingDayChanged || contractEndDateChanged) && targetSubscriptionId) {
      const localSubscription = await prisma.subscription.findFirst({
        where: {
          contaId: contaCtx.contaId,
          matriculaId: before.id,
        },
        select: {
          status: true,
          updatedAt: true,
        },
      });
      const localSnapshot = deriveLocalAssinaturaSnapshot(
        before as unknown as Record<string, unknown>,
        localSubscription,
      );
      const resolvedLocalSnapshot =
        financialContext?.mode === 'FAMILY'
          ? financialContext.localSnapshot
          : localSnapshot;

      let remoteSubscription: Awaited<ReturnType<typeof getSubscription>>;

      try {
        remoteSubscription = await getSubscription(targetSubscriptionId, { contaId: contaCtx.contaId });
      } catch (error) {
        const classified = classifyAsaasSubscriptionMutationError(error);
        if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
          return jsonError(
            409,
            'ASSINATURA_NAO_EDITAVEL',
            classified.providerMessage ??
              'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
          );
        }
        if (classified.kind === 'unauthorized') {
          return jsonError(
            502,
            'FINANCEIRO_AUTENTICACAO_INVALIDA',
            classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
          );
        }
        throw error;
      }

      if (remoteSubscription.deleted || remoteSubscription.status === 'EXPIRED') {
        return jsonError(
          409,
          'ASSINATURA_NAO_EDITAVEL',
          'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
        );
      }

      const currentNextDueDate = remoteSubscription.nextDueDate ?? resolvedLocalSnapshot?.nextDueDate;
      if (billingDayChanged && !currentNextDueDate) {
        return jsonError(
          409,
          'ASSINATURA_PENDENTE_SNAPSHOT',
          'O próximo vencimento ainda não foi materializado localmente. Aguarde a sincronização do webhook ou tente novamente com refresh.',
        );
      }

      const subscriptionUpdatePayload: Parameters<typeof updateSubscription>[1] = {};
      const nextDueDate =
        billingDayChanged && currentNextDueDate
          ? computeNextDueDate(currentNextDueDate, parsedBody.data.vencimentoDia as number)
          : currentNextDueDate;
      const effectiveEndDate =
        contractEndDateChanged && parsedBody.data.dataFimContrato
          ? formatAsaasDate(parsedBody.data.dataFimContrato)
          : remoteSubscription.endDate
            ? formatAsaasDate(remoteSubscription.endDate)
            : formatAsaasDate(before.dataFimContrato);

      if (nextDueDate && effectiveEndDate && compareAsaasDates(nextDueDate, effectiveEndDate) > 0) {
        return jsonError(
          422,
          'ASSINATURA_PERIODO_INVALIDO',
          `A próxima cobrança calculada (${formatPtBrDateOnly(nextDueDate)}) não pode ficar depois da data de fim da assinatura (${formatPtBrDateOnly(effectiveEndDate)}). Ajuste o dia de vencimento ou a data de fim.`,
          {
            nextDueDate,
            endDate: effectiveEndDate,
            billingDay: parsedBody.data.vencimentoDia ?? before.vencimentoDia,
          },
        );
      }

      if (billingDayChanged && nextDueDate) {
        subscriptionUpdatePayload.nextDueDate = nextDueDate;
        subscriptionUpdatePayload.updatePendingPayments = true;
      }

      if (contractEndDateChanged && parsedBody.data.dataFimContrato) {
        subscriptionUpdatePayload.endDate = formatAsaasDate(parsedBody.data.dataFimContrato);
      }

      try {
        await updateSubscription(
          targetSubscriptionId,
          subscriptionUpdatePayload,
          { contaId: contaCtx.contaId },
        );
      } catch (error) {
        const classified = classifyAsaasSubscriptionMutationError(error);
        if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
          return jsonError(
            409,
            'ASSINATURA_NAO_EDITAVEL',
            classified.providerMessage ??
              'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
          );
        }
        if (classified.kind === 'unauthorized') {
          return jsonError(
            502,
            'FINANCEIRO_AUTENTICACAO_INVALIDA',
            classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
          );
        }
        throw error;
      }

      subscriptionMetadata = {
        asaasSubscriptionId: targetSubscriptionId,
        subscriptionSync: {
          mode: financialContext?.mode ?? 'INDIVIDUAL',
          familyGroupId: financialContext?.family?.id ?? null,
          affectedMatriculaIds: financialContext?.family?.affectedMatriculaIds ?? [before.id],
          kind:
            billingDayChanged && contractEndDateChanged
              ? 'BILLING_DAY_AND_END_DATE_UPDATED'
              : billingDayChanged
                ? 'BILLING_DAY_UPDATED'
                : 'END_DATE_UPDATED',
          previousNextDueDate: currentNextDueDate,
          nextDueDate,
          previousBillingDay: before.vencimentoDia,
          nextBillingDay: parsedBody.data.vencimentoDia ?? before.vencimentoDia,
          previousEndDate: formatAsaasDate(before.dataFimContrato),
          nextEndDate: parsedBody.data.dataFimContrato
            ? formatAsaasDate(parsedBody.data.dataFimContrato)
            : formatAsaasDate(before.dataFimContrato),
        },
      };
      pendingLocalAlignment =
        financialContext?.mode !== 'FAMILY' && billingDayChanged && nextDueDate
          ? {
              matriculaId: before.id,
              contaId: contaCtx.contaId,
              dueDate: nextDueDate,
            }
          : null;
      pendingFamilyLocalUpdate =
        financialContext?.mode === 'FAMILY'
          ? {
              ...(billingDayChanged && nextDueDate ? { nextDueDate } : {}),
              ...(contractEndDateChanged && parsedBody.data.dataFimContrato
                ? { endDate: formatAsaasDate(parsedBody.data.dataFimContrato) }
                : {}),
            }
          : null;
    }

    const matricula = await atualizarDetalhesMatricula({
      id: ctxParams.id,
      contaId: contaCtx.contaId,
      actorId: contaCtx.sessionUserId,
      dataInicio: parsedBody.data.dataInicio,
      dataFimContrato: parsedBody.data.dataFimContrato,
      vencimentoDia: parsedBody.data.vencimentoDia,
      metadata: subscriptionMetadata,
    });

    if (!matricula) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
    }

    const localAlignment = pendingFamilyLocalUpdate && financialContext
      ? await updateFamilyFinancialLocalState({
          db: prisma,
          context: financialContext,
          nextDueDate: pendingFamilyLocalUpdate.nextDueDate,
          endDate: pendingFamilyLocalUpdate.endDate,
        })
      : pendingLocalAlignment
        ? await alignLocalPendingEnrollmentCharges({
            db: prisma,
            matriculaId: pendingLocalAlignment.matriculaId,
            contaId: pendingLocalAlignment.contaId,
            dueDate: pendingLocalAlignment.dueDate,
          })
        : null;

    return NextResponse.json(
      {
        data: mapMatriculaRecordToCoreDTO(matricula as unknown as Record<string, unknown>),
        asyncSync:
          (billingDayChanged || contractEndDateChanged) && targetSubscriptionId
            ? {
                provider: 'ASAAS',
                fields: [
                  ...(billingDayChanged ? ['nextDueDate', 'updatePendingPayments'] : []),
                  ...(contractEndDateChanged ? ['endDate'] : []),
                ],
                localAlignment,
                message:
                  'As datas da matrícula foram alinhadas com o vínculo financeiro e podem refletir nos próximos ciclos e nas pendências ainda editáveis.',
              }
            : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro ao atualizar matrícula:', error);
    if ((error as { name?: string }).name === 'ZodError') {
      return jsonError(422, 'ERRO_VALIDACAO', (error as Error).message, error as Error);
    }
    return jsonError(500, 'ERRO_ATUALIZAR_MATRICULA', (error as Error).message);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const url = new URL(req.url);
    const contaCtx = await resolveContaId(url.searchParams.get('contaId'));
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!contaCtx.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }

    const matriculaId = ctxParams.id;
    const contaId = contaCtx.contaId;
    const actorId = contaCtx.sessionUserId ?? null;

    let motivo: string | undefined;
    try {
      const body = await req.json();
      motivo = body?.motivo;
    } catch {
      // body opcional
    }

    const hardParam =
      url.searchParams.get('hard') ??
      url.searchParams.get('permanent') ??
      url.searchParams.get('forceDelete');
    const hardDeleteRequested =
      typeof hardParam === 'string' &&
      ['1', 'true', 'yes', 'on'].includes(hardParam.toLowerCase());

    if (!hardDeleteRequested) {
      const result = await syncMatriculaStatus({
        prisma,
        matriculaId,
        contaId,
        targetStatus: 'CANCELADA',
        actorId: actorId ?? 'system',
        motivo: motivo || undefined,
      });

      return NextResponse.json(
        mapMatriculaDeleteResultToDTO({
          success: true,
          action: 'CANCELADA',
          data: result,
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const eligibility = await canHardDeleteMatricula(matriculaId, contaId);
    if (!eligibility) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    if (!eligibility.ok) {
      return jsonError(
        409,
        'MATRICULA_HARD_DELETE_BLOCKED',
        'A exclusão permanente foi bloqueada porque a matrícula possui histórico financeiro ou contratual. Use cancelar matrícula para encerrar o vínculo sem apagar a trilha de auditoria.',
        {
          blockedBy: eligibility.details,
          guidance: [
            'Use cancelar matrícula para encerrar o fluxo sem perder histórico.',
            'Exclusão permanente só é permitida para cadastros sem cobranças, pagamentos, assinatura, parcelamento ou contrato aceito.',
          ],
        },
      );
    }

    await prisma.$transaction(async (tx) => {
      const verified = await tx.matricula.findFirst({
        where: { id: matriculaId, aluno: { contaId } },
        select: { id: true },
      });
      if (!verified) {
        throw new Error('Matrícula não encontrada');
      }

      await tx.auditLog.create({
        data: {
          contaId,
          actorType: actorId ? 'USER' : 'SYSTEM',
          actorId: actorId ?? undefined,
          action: 'MATRICULA_HARD_DELETED',
          entityType: 'MATRICULA',
          entityId: matriculaId,
          metadata: {
            motivo: motivo || null,
          },
        },
      });

      await tx.matricula.delete({ where: { id: matriculaId } });
    });

    return NextResponse.json(
      mapMatriculaDeleteResultToDTO({
        success: true,
        action: 'HARD_DELETED',
        deletedId: matriculaId,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ManualSyncError) {
      return jsonError(error.statusCode, error.code, error.message, error.details);
    }
    console.error('[MATRICULA_DELETE] Erro ao processar exclusão:', error);
    return jsonError(500, 'ERRO_DELETAR_MATRICULA', (error as Error).message);
  }
}
