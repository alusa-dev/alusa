import { logEnrollmentOperationalEvent } from '@/lib/observability/api-logger';
import { NextResponse } from 'next/server';
import { getSubscription } from '@alusa/finance';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { prisma } from '@/src/prisma';
import {
  atualizarDetalhesMatricula,
  buscarMatriculaPorId,
} from '@/src/server/enrollments/enrollment.service';
import { mapMatriculaRuleError } from '@/src/server/enrollments/enrollment-http-error';
import { ManualSyncError, syncMatriculaStatus } from '@/src/server/enrollments/enrollment-sync.service';
import { updateMatriculaInputDTOSchema } from '@/features/enrollments/dtos';
import {
  mapMatriculaDeleteResultToDTO,
  mapMatriculaRecordToCoreDTO,
  mapMatriculaRecordToResumoDTO,
} from '@/features/enrollments/mappers';
import {
  deriveLocalAssinaturaSnapshot,
  type AssinaturaSnapshot,
} from '@/src/server/enrollments/subscription-snapshot';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import {
  resolveMatriculaFinancialContext,
} from '@/src/server/enrollments/financial-context.service';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { apiJsonError } from '@/lib/api/standard-response';
import type { EnrollmentFinancialCommand } from '@alusa/finance';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJsonError(status, code, message, details);
}

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

const enrollmentWriteRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

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

function maxAsaasDate(...values: Array<string | Date | null | undefined>) {
  const valid = values
    .filter((value): value is string | Date => Boolean(value))
    .map((value) => formatAsaasDate(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, value) => (compareAsaasDates(value, latest) > 0 ? value : latest));
}

/** O Asaas usa fim inclusivo; BillingAllocation/BillingAgreement usa fim exclusivo. */
function exclusiveValidUntil(providerEndDate: string) {
  const date = new Date(`${providerEndDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida para vigência financeira.');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatPtBrDateOnly(value: string) {
  return new Date(`${value}T12:00:00.000Z`).toLocaleDateString('pt-BR');
}

type HardDeleteCheck = {
  ok: boolean;
  details: {
    cobrancas: number;
    cobrancasPorStatus: Record<string, number>;
    pagamentos: number;
    subscriptions: number;
    installmentPlans: number;
    contratos: number;
    grupoFamiliar: boolean;
    asaasSubscriptionId: string | null;
  };
};

async function canHardDeleteMatricula(
  matriculaId: string,
  contaId: string,
): Promise<HardDeleteCheck | null> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: { id: true, asaasSubscriptionId: true, matriculaFamiliarId: true },
  });
  if (!matricula) return null;

  const [cobrancas, pagamentos, subscriptions, installmentPlans, contratos] =
    await Promise.all([
      prisma.cobranca.count({ where: { contaId, matriculaId } }),
      prisma.pagamento.count({ where: { contaId, cobranca: { contaId, matriculaId } } }),
      prisma.subscription.count({ where: { contaId, matriculaId } }),
      prisma.installmentPlan.count({ where: { contaId, matriculaId } }),
      prisma.contrato.count({ where: { matriculaId, contaId } }),
    ]);

  const cobrancasPorStatusRaw = await prisma.cobranca.groupBy({
    by: ['status'],
    where: { contaId, matriculaId },
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
    contratos,
    grupoFamiliar: Boolean(matricula.matriculaFamiliarId),
    asaasSubscriptionId: matricula.asaasSubscriptionId ?? null,
  };

  const ok =
    cobrancas === 0 &&
    pagamentos === 0 &&
    subscriptions === 0 &&
    installmentPlans === 0 &&
    contratos === 0 &&
    !matricula.matriculaFamiliarId &&
    !matricula.asaasSubscriptionId;

  return { ok, details };
}

export async function getMatriculaRoute(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const contaCtx = await resolveTenantSession();
    if (!contaCtx.ok) {
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
        financialContext?.mode === 'FAMILY' || financialContext?.sharedAgreement
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
    const canonicalAllocation = await prisma.billingAllocation.findFirst({
      where: {
        contaId: contaCtx.contaId,
        matriculaId: matricula.id,
        kind: 'TUITION',
        status: { in: ['ACTIVE', 'SCHEDULED'] },
      },
      orderBy: { validFrom: 'desc' },
      select: {
        id: true,
        netAmount: true,
        agreement: {
          select: {
            id: true,
            status: true,
            desiredValue: true,
            confirmedValue: true,
            reconciliationError: true,
          },
        },
      },
    });

    const mappedMatricula = {
      ...(matricula as unknown as Record<string, unknown>),
      asaasSubscriptionId: targetSubscriptionId,
      cobrancas: familyEnrollmentCharge
        ? [familyEnrollmentCharge, ...((matricula.cobrancas ?? []) as unknown[])]
        : matricula.cobrancas,
      assinaturaSnapshot,
      billingAgreement: canonicalAllocation
        ? {
            id: canonicalAllocation.agreement.id,
            allocationId: canonicalAllocation.id,
            allocationValue: Number(canonicalAllocation.netAmount),
            desiredValue: Number(canonicalAllocation.agreement.desiredValue),
            confirmedValue: Number(canonicalAllocation.agreement.confirmedValue),
            status: canonicalAllocation.agreement.status,
            reconciliationError: canonicalAllocation.agreement.reconciliationError,
          }
        : null,
      isSharedSubscription: Boolean(
        financialContext?.sharedAgreement &&
          financialContext.sharedAgreement.affectedMatriculaIds.length > 1,
      ),
      financialContext: financialContext
        ? {
            mode: financialContext.mode,
            sourceMatriculaId: financialContext.sourceMatriculaId,
            targetMatriculaId: financialContext.targetMatriculaId,
            familyGroupId: financialContext.family?.id ?? null,
            responsavelFinanceiro: financialContext.family?.responsavel ?? null,
            affectedMatriculaIds:
              financialContext.family?.affectedMatriculaIds ??
              financialContext.sharedAgreement?.affectedMatriculaIds ??
              [matricula.id],
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
    logEnrollmentOperationalEvent('api.enrollment.read.failed', error);
    return jsonError(
      500,
      'ERRO_BUSCAR_MATRICULA',
      'Não foi possível carregar a matrícula. Tente novamente em instantes.',
    );
  }
}

export async function patchMatriculaRoute(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const contaCtx = await resolveTenantSession(parsedBody.data.contaId ?? null);
    if (!contaCtx.ok) {
      return jsonError(
        contaCtx.reason === 'CONTA_MISMATCH' ? 403 : 401,
        contaCtx.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        contaCtx.reason === 'CONTA_MISMATCH'
          ? 'Conta informada não pertence ao usuário.'
          : 'Usuário não autenticado',
      );
    }

    try {
      await assertPlatformAccessForConta({ contaId: contaCtx.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    if (parsedBody.data.status) {
      if (parsedBody.data.dataInicio || parsedBody.data.dataFimContrato || parsedBody.data.vencimentoDia) {
        return jsonError(
          422,
          'PAYLOAD_INVALIDO',
          'Atualização de status não pode ser enviada junto com edição de datas ou vencimento.',
        );
      }

      return jsonError(
        422,
        'OPERACAO_STATUS_INDISPONIVEL',
        'Status de matrícula deve ser alterado pela operação acadêmica correspondente para preservar a sincronização financeira e a trilha de auditoria.',
      );
    }

    const before = await prisma.matricula.findFirst({
      where: { id: ctxParams.id, aluno: { contaId: contaCtx.contaId } },
      select: {
        id: true,
        matriculaFamiliarId: true,
        asaasSubscriptionId: true,
        dataInicio: true,
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
    let pendingFinancialCommand: Omit<EnrollmentFinancialCommand, 'version' | 'commandId' | 'actorId' | 'matriculaId'> | undefined;
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
    const sharedAgreement = financialContext?.sharedAgreement ?? null;
    const sharedMatriculaIds = sharedAgreement?.affectedMatriculaIds ?? [];
    let sharedEffectiveEndDate: string | null = null;

    const startDateChanged = Boolean(
      parsedBody.data.dataInicio &&
      formatAsaasDate(parsedBody.data.dataInicio) !== formatAsaasDate(before.dataInicio),
    );
    if (startDateChanged) {
      const [scheduledIndividualEvent, scheduledFamilyEvent] = await Promise.all([
        prisma.matriculaBillingOutbox.findFirst({
          where: {
            contaId: contaCtx.contaId,
            matriculaId: before.id,
            eventType: { not: 'PROVISION_ENROLLMENT_FEE' },
            status: { in: ['PENDING', 'FAILED', 'PROCESSING', 'REQUIRES_RECONCILIATION'] },
          },
          select: { id: true, status: true },
        }),
        before.matriculaFamiliarId
          ? prisma.familyBillingOutbox.findFirst({
              where: {
                contaId: contaCtx.contaId,
                matriculaFamiliarId: before.matriculaFamiliarId,
                eventType: { startsWith: 'FUTURE_FAMILY_RECURRING:' },
                status: { in: ['PENDING', 'FAILED', 'PROCESSING', 'REQUIRES_RECONCILIATION'] },
              },
              select: { id: true, status: true },
            })
          : Promise.resolve(null),
      ]);
      if (scheduledIndividualEvent && ['PROCESSING', 'REQUIRES_RECONCILIATION'].includes(scheduledIndividualEvent.status)) {
        return jsonError(409, 'DATA_INICIO_REQUER_RECONCILIACAO', 'A vigência não pode ser alterada enquanto o evento financeiro estiver em processamento ou reconciliação.');
      }
      if (scheduledFamilyEvent && ['PROCESSING', 'REQUIRES_RECONCILIATION'].includes(scheduledFamilyEvent.status)) {
        return jsonError(409, 'DATA_INICIO_FAMILIAR_REQUER_RECONCILIACAO', 'A vigência familiar não pode ser alterada enquanto o evento financeiro estiver em processamento ou reconciliação.');
      }
      if (targetSubscriptionId) {
        return jsonError(
          409,
          'DATA_INICIO_REQUER_REPROGRAMACAO_FINANCEIRA',
          'A data de início não pode ser alterada enquanto houver assinatura recorrente já provisionada.',
        );
      }
    }

    if (contractEndDateChanged && parsedBody.data.dataFimContrato && sharedAgreement) {
      const sharedMatriculas = await prisma.matricula.findMany({
        where: {
          contaId: contaCtx.contaId,
          id: { in: sharedMatriculaIds },
        },
        select: { id: true, dataFimContrato: true },
      });
      if (sharedMatriculas.length !== sharedMatriculaIds.length) {
        return jsonError(
          409,
          'ACORDO_CANONICO_INCOMPLETO',
          'Não foi possível recalcular a vigência porque o acordo financeiro não contém todas as matrículas vinculadas.',
        );
      }
      sharedEffectiveEndDate = maxAsaasDate(
        ...sharedMatriculas.map((item) =>
          item.id === before.id ? parsedBody.data.dataFimContrato : item.dataFimContrato,
        ),
      );
    }

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

      const subscriptionUpdatePayload: { nextDueDate?: string; endDate?: string; updatePendingPayments?: boolean } = {};
      const nextDueDate =
        billingDayChanged && currentNextDueDate
          ? computeNextDueDate(currentNextDueDate, parsedBody.data.vencimentoDia as number)
          : currentNextDueDate;
      const effectiveEndDate =
        contractEndDateChanged && parsedBody.data.dataFimContrato
          ? sharedEffectiveEndDate ?? formatAsaasDate(parsedBody.data.dataFimContrato)
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

      if (
        contractEndDateChanged &&
        parsedBody.data.dataFimContrato &&
        (!remoteSubscription.endDate || compareAsaasDates(effectiveEndDate, formatAsaasDate(remoteSubscription.endDate)) !== 0)
      ) {
        subscriptionUpdatePayload.endDate = formatAsaasDate(parsedBody.data.dataFimContrato);
        if (sharedAgreement) {
          subscriptionUpdatePayload.endDate = effectiveEndDate;
        }
      }

      if (
        Object.keys(subscriptionUpdatePayload).length > 0 ||
        (contractEndDateChanged && Boolean(sharedAgreement))
      ) {
        const affectedMatriculaIds = financialContext?.family?.affectedMatriculaIds ?? (sharedMatriculaIds.length ? sharedMatriculaIds : [before.id]);
        pendingFinancialCommand = {
          targetSubscriptionId,
          affectedMatriculaIds,
          localPatchMatriculaIds: [before.id],
          remotePatch: {
            ...(subscriptionUpdatePayload.nextDueDate ? { nextDueDate: subscriptionUpdatePayload.nextDueDate } : {}),
            ...(subscriptionUpdatePayload.endDate ? { endDate: subscriptionUpdatePayload.endDate } : {}),
            ...(subscriptionUpdatePayload.updatePendingPayments ? { updatePendingPayments: true } : {}),
          },
          localPatch: {
            ...(parsedBody.data.dataInicio ? { dataInicio: new Date(parsedBody.data.dataInicio).toISOString() } : {}),
            ...(parsedBody.data.dataFimContrato ? { dataFimContrato: new Date(parsedBody.data.dataFimContrato).toISOString() } : {}),
            ...(billingDayChanged && parsedBody.data.vencimentoDia ? { vencimentoDia: parsedBody.data.vencimentoDia } : {}),
          },
          snapshot: {
            ...(billingDayChanged ? { dueDay: parsedBody.data.vencimentoDia as number, nextDueDate: nextDueDate ?? null } : {}),
            ...(contractEndDateChanged ? { validUntil: exclusiveValidUntil(effectiveEndDate) } : {}),
          },
          ...(contractEndDateChanged && parsedBody.data.dataFimContrato
            ? {
                allocationValidity: {
                  matriculaIds: [before.id],
                  validUntil: exclusiveValidUntil(formatAsaasDate(parsedBody.data.dataFimContrato)),
                },
              }
            : {}),
        };
      }

      subscriptionMetadata = {
        asaasSubscriptionId: targetSubscriptionId,
        subscriptionSync: {
          mode: financialContext?.mode ?? 'INDIVIDUAL',
          familyGroupId: financialContext?.family?.id ?? null,
          affectedMatriculaIds:
            financialContext?.family?.affectedMatriculaIds ??
            (sharedAgreement?.affectedMatriculaIds ?? [before.id]),
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
            ? effectiveEndDate
            : formatAsaasDate(before.dataFimContrato),
          sharedAgreementId: sharedAgreement?.id ?? null,
          sharedMatriculaIds,
        },
      };

    }

    const matricula = await atualizarDetalhesMatricula({
      id: ctxParams.id,
      contaId: contaCtx.contaId,
      actorId: contaCtx.userId,
      dataInicio: parsedBody.data.dataInicio,
      dataFimContrato: parsedBody.data.dataFimContrato,
      vencimentoDia: parsedBody.data.vencimentoDia,
      metadata: subscriptionMetadata,
      financialCommand: pendingFinancialCommand,
    });

    if (!matricula) {
      return jsonError(404, 'MATRICULA_NAO_ENCONTRADA', 'Matrícula não encontrada');
    }


    return NextResponse.json(
      {
        data: mapMatriculaRecordToCoreDTO(matricula as unknown as Record<string, unknown>),
        asyncSync:
          (billingDayChanged || contractEndDateChanged) && targetSubscriptionId
            ? {
                status: 'PENDING',
                operationId: 'financialCommandEventId' in matricula ? matricula.financialCommandEventId : null,
                provider: 'ASAAS',
                fields: [
                  ...(billingDayChanged ? ['nextDueDate', 'updatePendingPayments'] : []),
                  ...(contractEndDateChanged ? ['endDate'] : []),
                ],
                message: 'As datas acadêmicas foram salvas e a atualização financeira aguarda confirmação do Asaas; a projeção local será concluída automaticamente.',
              }
            : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    logEnrollmentOperationalEvent('api.enrollment.update.failed', error);
    if ((error as { name?: string }).name === 'ZodError') {
      const issues = (error as { issues?: unknown }).issues;
      return jsonError(422, 'ERRO_VALIDACAO', 'Dados da matrícula inválidos.', issues);
    }
    const ruleError = mapMatriculaRuleError(error);
    if (ruleError) return jsonError(ruleError.status, ruleError.code, ruleError.message);
    return jsonError(500, 'ERRO_ATUALIZAR_MATRICULA', 'Não foi possível atualizar a matrícula.');
  }
}

export async function deleteMatriculaRoute(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const url = new URL(req.url);
    const contaCtx = await resolveTenantSession(url.searchParams.get('contaId'));
    if (!contaCtx.ok) {
      return jsonError(
        contaCtx.reason === 'CONTA_MISMATCH' ? 403 : 401,
        contaCtx.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO',
        contaCtx.reason === 'CONTA_MISMATCH'
          ? 'Conta informada não pertence ao usuário.'
          : 'Usuário não autenticado',
      );
    }

    if (!contaCtx.role || !enrollmentWriteRoles.has(String(contaCtx.role).toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        'Usuário não tem permissão para cancelar ou excluir matrículas.',
      );
    }

    try {
      await assertPlatformAccessForConta({ contaId: contaCtx.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) {
        return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      }
      throw error;
    }

    const matriculaId = ctxParams.id;
    const contaId = contaCtx.contaId;
    const actorId = contaCtx.userId;

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
      let result;
      try {
        result = await syncMatriculaStatus({
        prisma,
        matriculaId,
        contaId,
        targetStatus: 'CANCELADA',
        actorId: actorId ?? 'system',
        motivo: motivo || undefined,
        });
      } catch (error) {
        if (error instanceof ManualSyncError) {
          const operation = await prisma.matriculaOperacao.findFirst({
            where: {
              contaId,
              matriculaId,
              tipo: 'CANCELAMENTO',
              status: 'DIVERGENTE',
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true, correlationId: true, metadata: true },
          });
          const metadata = operation?.metadata;
          if (operation && metadata && typeof metadata === 'object' && 'retryable' in metadata && metadata.retryable === true) {
            const current = await prisma.matricula.findFirst({
              where: { id: matriculaId, contaId },
              select: { status: true },
            });
            return NextResponse.json({
              success: true,
              pending: true,
              retryable: true,
              code: 'CANCELAMENTO_FINANCEIRO_PENDENTE',
              message: 'O cancelamento aguarda confirmação financeira e será reconciliado automaticamente. A matrícula permanece no estado atual.',
              correlationId: operation.correlationId,
              operationId: operation.id,
              matriculaId,
              status: current?.status ?? null,
            }, { status: 202, headers: { 'cache-control': 'no-store' } });
          }
        }
        throw error;
      }

      if (result.deferred) {
        return NextResponse.json({
          success: true,
          pending: true,
          code: 'CANCELAMENTO_AGUARDANDO_PROVISIONAMENTO',
          message: 'O cancelamento foi registrado e será concluído após a operação financeira em andamento.',
          matriculaId,
          previousStatus: result.previousStatus,
          status: result.previousStatus,
        }, { status: 202, headers: { 'cache-control': 'no-store' } });
      }

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
        'A exclusão permanente foi bloqueada porque a matrícula possui histórico financeiro, contratual ou pertence a um grupo familiar. Use cancelar matrícula para encerrar o vínculo sem apagar a trilha de auditoria.',
        {
          blockedBy: eligibility.details,
          guidance: [
            'Use cancelar matrícula para encerrar o fluxo sem perder histórico.',
            'Exclusão permanente só é permitida para rascunhos sem cobranças, pagamentos, assinatura, parcelamento, contrato ou vínculo familiar.',
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
    logEnrollmentOperationalEvent('api.enrollment.delete.failed', error);
    return jsonError(500, 'ERRO_DELETAR_MATRICULA', 'Não foi possível excluir a matrícula.');
  }
}
