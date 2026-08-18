import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import {
  AsaasEnvError,
  KycNotApprovedError,
  buildStandaloneExternalReference,
  deletePayment,
  getPayment,
  handlePaymentWebhook,
  isAsaasEnabled,
  mapAsaasPaymentStatusToCobranca,
  readPaymentFullPreflight,
  resolveCobrancaDisplayStatus,
  resolveLiquidacaoFromAsaasPayment,
  resolveOperationalChargePayment,
  mapOperationalStatusToCobrancaDisplay,
  syncPaymentStateFromAsaas,
  updatePayment,
  auditLogService,
  evaluatePaymentActionPolicy,
  normalizeAsaasPaymentSnapshotStatus,
  runAsaasPaymentCommand,
  type PaymentActionDecision,
  type PaymentOrigin,
  resolveStandaloneChargeTipo,
} from '@alusa/finance';
import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';
import type { AsaasCreatePaymentInput } from '@alusa/finance';
import {
  cobrancaDetailResultDTOSchema,
  cobrancaMutationResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import {
  mapCobrancaDetailResultToDTO,
  mapCobrancaMutationResultToDTO,
} from '@/features/financeiro/cobrancas/mappers';
import {
  buildAcademicAsaasData,
  buildStandaloneAsaasData,
  mapBillingTypeToFormaPagamento,
  shouldFetchAcademicAsaasDetail,
  shouldFetchStandaloneAsaasDetail,
  toNullableNumber,
} from '@/src/server/finance/asaas-payment-detail-policy';
import { recordAsaasReadDecision } from '@/src/server/finance/asaas-read-observability';
import { logFinanceApiError } from '@/lib/api/finance-api-response';
import { buildChargeDetailCacheKey, invalidateChargeResourceCache } from '@/lib/cache/invalidation';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { isCacheLayerEnabled } from '@/lib/cache/tenant-cache';
import { privateJson } from '@/lib/private-cache';

const ASAAS_EDITABLE_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_PAID_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const CHARGE_DETAIL_CACHE_SECONDS = 20;
const CHARGE_DETAIL_STALE_SECONDS = 40;

const COBRANCA_STATUS_PRECEDENCE: Record<string, number> = {
  PENDENTE: 5,
  A_VENCER: 10,
  PROCESSANDO: 15,
  ATRASADO: 30,
  PAGO: 40,
  CANCELAMENTO_PENDENTE: 80,
  ESTORNADO_PARCIAL: 90,
  ESTORNADO: 92,
  CANCELADO: 95,
};

const CHARGE_TO_COBRANCA_STATUS: Record<string, StatusCobranca> = {
  CREATED: 'PENDENTE',
  PENDING_SYNC: 'PENDENTE',
  OPEN: 'PENDENTE',
  OVERDUE: 'ATRASADO',
  PAID: 'PAGO',
  REFUNDED: 'ESTORNADO',
  CANCELED: 'CANCELADO',
};

function getCobrancaStatusPrecedence(status: string | null | undefined): number {
  return status ? COBRANCA_STATUS_PRECEDENCE[status] ?? 0 : 0;
}

function chooseHighestPrecedenceCobrancaStatus(statuses: Array<StatusCobranca | string | null | undefined>) {
  return statuses.reduce<StatusCobranca | string | null>((selected, candidate) => {
    if (!candidate) return selected;
    if (!selected) return candidate;
    return getCobrancaStatusPrecedence(candidate) >= getCobrancaStatusPrecedence(selected)
      ? candidate
      : selected;
  }, null);
}

function mapChargeStatusToCobrancaStatus(status?: string | null): StatusCobranca | null {
  if (!status) return null;
  return CHARGE_TO_COBRANCA_STATUS[status] ?? null;
}

type ChargePaymentRules = {
  interestValue: number | null;
  fineValue: number | null;
  fineType: string | null;
  discountValue: number | null;
  discountType: string | null;
  discountDueDateLimitDays: number | null;
};

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function paymentRulesFromParticipantSnapshot(value: unknown): ChargePaymentRules | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  const interestValue = numberOrNull(snapshot.interestPercent);
  const fine = snapshot.fine && typeof snapshot.fine === 'object'
    ? snapshot.fine as Record<string, unknown>
    : null;
  const discount = snapshot.discount && typeof snapshot.discount === 'object'
    ? snapshot.discount as Record<string, unknown>
    : null;
  const fineValue = numberOrNull(fine?.value);
  const discountValue = numberOrNull(discount?.value);
  if (interestValue == null && fineValue == null && discountValue == null) return null;

  return {
    interestValue,
    fineValue,
    fineType: typeof fine?.type === 'string' ? fine.type : 'PERCENTAGE',
    discountValue,
    discountType: typeof discount?.type === 'string' ? discount.type : 'PERCENTAGE',
    discountDueDateLimitDays: discountValue == null ? null : Number(discount?.dueDateLimitDays ?? 0),
  };
}

async function findEventPaymentRulesForCharge(params: {
  contaId: string;
  chargeId: string;
  installmentPlanId?: string | null;
  asaasPaymentId?: string | null;
}): Promise<ChargePaymentRules | null> {
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      contaId: params.contaId,
      OR: [
        { standaloneChargeId: params.chargeId },
        ...(params.installmentPlanId ? [{ standaloneChargeId: params.installmentPlanId }] : []),
        ...(params.asaasPaymentId ? [{ asaasPaymentId: params.asaasPaymentId }] : []),
      ],
    },
    select: { registrationPaymentRules: true },
  });

  return paymentRulesFromParticipantSnapshot(participant?.registrationPaymentRules);
}

function mapPaymentRulesToCobrancaFields(rules: ChargePaymentRules | null) {
  if (!rules) return {};

  return {
    jurosPercentual: rules.interestValue,
    multaTipo: rules.fineType === 'PERCENTAGE' ? 'PERCENTUAL' : rules.fineType === 'FIXED' ? 'VALOR_FIXO' : null,
    multaPercentual: rules.fineType === 'PERCENTAGE' ? rules.fineValue : null,
    multaValorFixo: rules.fineType === 'FIXED' ? rules.fineValue : null,
    descontoTipo: rules.discountType === 'PERCENTAGE' ? 'PERCENTUAL' : rules.discountType === 'FIXED' ? 'VALOR_FIXO' : null,
    descontoPercentual: rules.discountType === 'PERCENTAGE' ? rules.discountValue : null,
    descontoValorFixo: rules.discountType === 'FIXED' ? rules.discountValue : null,
    descontoPrazoMaximo: rules.discountDueDateLimitDays == null
      ? null
      : rules.discountDueDateLimitDays === 0
        ? 'ATE_VENCIMENTO'
        : `${rules.discountDueDateLimitDays}_DIAS`,
  };
}

function getEffectiveRemotePaymentStatus(
  payment?: { status?: string | null; deleted?: boolean | null; billingType?: string | null } | null,
) {
  if (!payment) return null;
  return normalizeAsaasPaymentSnapshotStatus({
    status: payment.status,
    billingType: payment.billingType,
    deleted: payment.deleted,
  }) ?? payment.status ?? null;
}

async function convergeLocalCanceledPayment(params: {
  contaId: string;
  cobrancaId?: string | null;
  chargeId?: string | null;
  asaasPaymentId?: string | null;
  actorId?: string | null;
  reason?: string;
}) {
  const now = new Date();
  const reason = params.reason ?? 'Cancelada no Asaas';

  await prisma.$transaction(async (tx) => {
    if (params.cobrancaId) {
      await tx.cobranca.updateMany({
        where: {
          id: params.cobrancaId,
          contaId: params.contaId,
          status: { notIn: ['CANCELADO', 'PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
        },
        data: {
          status: 'CANCELADO',
          asaasStatus: 'DELETED',
          canceladoEm: now,
          canceladoMotivo: reason,
          canceladoPor: params.actorId ?? 'system',
          liquidacaoStatus: 'NAO_APLICAVEL',
        },
      });
    }

    const chargeWhere = [
      params.chargeId ? { id: params.chargeId } : null,
      params.cobrancaId ? { cobrancaId: params.cobrancaId } : null,
      params.asaasPaymentId ? { asaasPaymentId: params.asaasPaymentId } : null,
    ].filter((where): where is { id: string } | { cobrancaId: string } | { asaasPaymentId: string } => Boolean(where));

    if (chargeWhere.length > 0) {
      await tx.charge.updateMany({
        where: {
          contaId: params.contaId,
          OR: chargeWhere,
          status: { notIn: ['CANCELED', 'PAID', 'REFUNDED'] },
        },
        data: {
          status: 'CANCELED',
          statusUpdatedAt: now,
          asaasStatus: 'DELETED',
          liquidacaoStatus: 'NAO_APLICAVEL',
        },
      });
    }
  });
}

function mutationError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    {
      success: false,
      code,
      error: message,
      ...extra,
    },
    { status },
  );
}

function editBlockedError(params: { status: string; source: 'LOCAL' | 'ASAAS' }) {
  const isPaid = params.source === 'ASAAS'
    ? ASAAS_PAID_PAYMENT_STATUSES.has(params.status)
    : params.status === 'PAID' || params.status === 'PAGO';

  return mutationError(
    isPaid ? 409 : 400,
    isPaid ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE' : 'EDIT_NOT_ALLOWED_FOR_CHARGE_STATUS',
    params.source === 'ASAAS'
      ? `Não é possível editar cobrança com status ${params.status} no Asaas`
      : `Não é possível editar cobrança com status ${params.status}`,
    params.source === 'ASAAS'
      ? { asaasStatus: params.status }
      : { status: params.status },
  );
}

function cancelBlockedError(params: { status: string; source: 'LOCAL' | 'ASAAS' }) {
  const isPaid = params.source === 'ASAAS'
    ? ASAAS_PAID_PAYMENT_STATUSES.has(params.status)
    : params.status === 'PAID' || params.status === 'PAGO';

  return mutationError(
    isPaid ? 409 : 400,
    isPaid ? 'CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE' : 'CANCEL_NOT_ALLOWED_FOR_CHARGE_STATUS',
    params.source === 'ASAAS'
      ? `Cobrança paga no Asaas (${params.status}). Não é possível cancelar.`
      : `Não é possível cancelar cobrança com status ${params.status}.`,
    params.source === 'ASAAS'
      ? { asaasStatus: params.status }
      : { status: params.status },
  );
}

function policyBlockedError(params: {
  action: 'EDIT' | 'CANCEL';
  decision: PaymentActionDecision;
  status?: string | null;
  source?: 'LOCAL' | 'ASAAS';
}) {
  const fallback = params.action === 'EDIT'
    ? editBlockedError({ status: params.status ?? 'DESCONHECIDO', source: params.source ?? 'LOCAL' })
    : cancelBlockedError({ status: params.status ?? 'DESCONHECIDO', source: params.source ?? 'LOCAL' });

  if (!params.decision.code || !params.decision.reason) {
    return fallback;
  }

  const isPaidBlock =
    params.decision.code.includes('PAID') ||
    params.status === 'RECEIVED' ||
    params.status === 'CONFIRMED' ||
    params.status === 'RECEIVED_IN_CASH' ||
    params.status === 'DUNNING_RECEIVED' ||
    params.status === 'PAGO' ||
    params.status === 'PAID';

  return mutationError(
    isPaidBlock ? 409 : 400,
    isPaidBlock
      ? params.action === 'EDIT'
        ? 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE'
        : 'CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE'
      : params.decision.code,
    params.decision.reason,
    {
      ...(params.source === 'ASAAS' ? { asaasStatus: params.status } : { status: params.status }),
      ...(params.decision.hint ? { hint: params.decision.hint } : {}),
    },
  );
}

function resolveAcademicPaymentOrigin(tipo?: string | null): PaymentOrigin {
  switch (tipo) {
    case 'PARCELADA':
      return 'INSTALLMENT';
    case 'RECORRENTE':
      return 'SUBSCRIPTION';
    case 'TAXA_MATRICULA':
      return 'ENROLLMENT_FEE';
    case 'AVULSA':
      return 'STANDALONE';
    default:
      return 'ACADEMIC';
  }
}

function resolveStandaloneDisplayedStatus(params: {
  localChargeStatus: string;
  remotePaymentStatus?: string | null;
  dueDate?: Date | null;
}) {
  const localStatus = mapChargeStatusToCobrancaStatus(params.localChargeStatus) ?? 'PENDENTE';
  const remoteStatus = params.remotePaymentStatus
    ? mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, { dueDate: params.dueDate })
    : null;

  return chooseHighestPrecedenceCobrancaStatus([localStatus, remoteStatus]) ?? localStatus;
}

function resolveAcademicDisplayedStatus(params: {
  localCobrancaStatus: string;
  localChargeStatus?: string | null;
  remotePaymentStatus?: string | null;
  dueDate: Date;
}) {
  const localChargeMappedStatus = mapChargeStatusToCobrancaStatus(params.localChargeStatus);
  const remoteStatus = params.remotePaymentStatus
    ? mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, { dueDate: params.dueDate })
    : null;

  return chooseHighestPrecedenceCobrancaStatus([
    params.localCobrancaStatus,
    localChargeMappedStatus,
    remoteStatus,
  ]) ?? params.localCobrancaStatus;
}

function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveStandaloneLiquidacaoStatus(params: {
  displayedStatus: string;
  remotePaymentStatus?: string | null;
  creditDate?: string | null;
  billingType?: string | null;
}): 'PENDENTE' | 'DISPONIVEL' | 'NAO_APLICAVEL' | null {
  if (params.displayedStatus !== 'PAGO') {
    return null;
  }

  return resolveLiquidacaoFromAsaasPayment({
    asaasStatus: params.remotePaymentStatus,
    creditDate: params.creditDate,
    billingType: params.billingType,
  });
}

function buildAsaasPaymentUpdatePayload(params: {
  currentPayment: Awaited<ReturnType<typeof getPayment>>;
  changes: {
    valor?: unknown;
    vencimento?: unknown;
    descricao?: unknown;
    jurosPercentual?: unknown;
    multaValorFixo?: unknown;
    multaPercentual?: unknown;
    descontoPercentual?: unknown;
    descontoValorFixo?: unknown;
    descontoPrazoMaximo?: unknown;
    desconto?: unknown;
    normalizedMultaTipo?: string | undefined;
    normalizedDescontoTipo?: string | undefined;
  };
}): Partial<AsaasCreatePaymentInput> {
  const {
    currentPayment,
    changes: {
      valor,
      vencimento,
      descricao,
      jurosPercentual,
      multaValorFixo,
      multaPercentual,
      descontoPercentual,
      descontoValorFixo,
      descontoPrazoMaximo,
      desconto,
      normalizedMultaTipo,
      normalizedDescontoTipo,
    },
  } = params;

  const payload: Partial<AsaasCreatePaymentInput> = {
    billingType: currentPayment.billingType ?? 'UNDEFINED',
    value: valor !== undefined ? Number(valor) : Number(currentPayment.value ?? 0),
    dueDate:
      vencimento !== undefined
        ? (typeof vencimento === 'string'
            ? (vencimento.includes('T') ? vencimento.split('T')[0] : vencimento)
            : new Date(vencimento as Date).toISOString().slice(0, 10))
        : currentPayment.dueDate,
  };

  if (descricao !== undefined) {
    payload.description = String(descricao || '');
  }

  if (jurosPercentual !== undefined && Number(jurosPercentual) >= 0) {
    payload.interest = { value: Number(jurosPercentual) };
  }

  if (
    (multaPercentual !== undefined || multaValorFixo !== undefined) &&
    Number(normalizedMultaTipo === 'VALOR_FIXO' ? multaValorFixo : multaPercentual) >= 0
  ) {
    payload.fine = {
      value: Number(normalizedMultaTipo === 'VALOR_FIXO' ? multaValorFixo : multaPercentual),
      type: normalizedMultaTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
    };
  }

  const dueDateLimitDays = parseDiscountDueDateLimitDays(descontoPrazoMaximo);

  if (descontoPercentual !== undefined && normalizedDescontoTipo !== 'VALOR_FIXO') {
    const discountValue = Math.max(0, Number(descontoPercentual) || 0);
    payload.discount = {
      value: discountValue,
      type: 'PERCENTAGE',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  } else if (descontoValorFixo !== undefined && normalizedDescontoTipo === 'VALOR_FIXO') {
    const discountValue = Math.max(0, Number(descontoValorFixo) || 0);
    payload.discount = {
      value: discountValue,
      type: 'FIXED',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  } else if (desconto !== undefined) {
    const discountValue = Math.max(0, Number(desconto) || 0);
    payload.discount = {
      value: discountValue,
      type: normalizedDescontoTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  }

  return payload;
}

function parseDiscountDueDateLimitDays(descontoPrazoMaximo?: unknown): number {
  if (!descontoPrazoMaximo || descontoPrazoMaximo === 'ATE_VENCIMENTO') {
    return 0;
  }

  const match = String(descontoPrazoMaximo).match(/(\d+)_DIAS/);
  return match ? parseInt(match[1], 10) : 0;
}

function resolveCanonicalDiscountDueDateLimit(params: {
  descontoPrazoMaximo?: unknown;
  normalizedDescontoTipo?: string;
  descontoPercentual?: unknown;
  descontoValorFixo?: unknown;
  desconto?: unknown;
}) {
  if (params.descontoPrazoMaximo === undefined) {
    return undefined;
  }

  const discountValue =
    params.normalizedDescontoTipo === 'VALOR_FIXO'
      ? Number(params.descontoValorFixo ?? params.desconto ?? 0)
      : Number(params.descontoPercentual ?? params.desconto ?? 0);

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return 'ATE_VENCIMENTO';
  }

  return parseDiscountDueDateLimitDays(params.descontoPrazoMaximo) === 0
    ? 'ATE_VENCIMENTO'
    : `${parseDiscountDueDateLimitDays(params.descontoPrazoMaximo)}_DIAS`;
}

function buildDeletedPaymentWebhookPayload(
  payment: Awaited<ReturnType<typeof deletePayment>>,
  fallbackExternalReference?: string,
) {
  return {
    event: 'PAYMENT_DELETED',
    payment: {
      id: payment.id,
      status: 'DELETED',
      value: Number(payment.value ?? 0),
      netValue: Number(payment.netValue ?? payment.value ?? 0),
      originalValue: payment.originalValue ?? null,
      externalReference: payment.externalReference ?? fallbackExternalReference ?? undefined,
      subscription: payment.subscription ?? null,
      installment: payment.installment ?? null,
      installmentNumber: null,
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? null,
      clientPaymentDate: payment.clientPaymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      billingType: payment.billingType ?? null,
      deleted: payment.deleted ?? true,
    },
  } as const;
}

async function applyImmediateDeletedPaymentConvergence(
  contaId: string,
  payment: Awaited<ReturnType<typeof getPayment>>,
  fallbackExternalReference?: string,
): Promise<boolean> {
  const webhookResult = await handlePaymentWebhook(
    contaId,
    buildDeletedPaymentWebhookPayload(
      payment as Awaited<ReturnType<typeof deletePayment>>,
      fallbackExternalReference,
    ),
  );
  return webhookResult.success;
}

/**
 * GET /api/cobrancas/[id]
 * Retorna detalhes completos de uma cobrança específica
 * 
 * ADR: GET é READ-ONLY. Não escreve no banco.
 * Status e valores são refletidos apenas via webhook.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    const { contaId } = user;
    const forceRefresh = new URL(_req.url).searchParams.get('fresh') === '1';
    const asaasActive = isAsaasEnabled();

    const { id } = rawParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    const cacheKey = buildChargeDetailCacheKey(contaId, id);
    const canUseDetailCache = isCacheLayerEnabled() && !forceRefresh;
    if (canUseDetailCache) {
      const cached = await getTenantCacheAdapter().get<unknown>(cacheKey);
      if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
        return privateJson(cached.body, {
          maxAgeSeconds: CHARGE_DETAIL_CACHE_SECONDS,
          staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
          cacheState: cached.state,
        });
      }
    }

    const respondDetail = async (body: unknown) => {
      if (!canUseDetailCache) {
        return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
      }

      await getTenantCacheAdapter()
        .set(cacheKey, body, {
          ttlSeconds: CHARGE_DETAIL_CACHE_SECONDS,
          staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
        })
        .catch((error) => {
          console.warn('[GET /api/cobrancas/[id]] Falha ao gravar cache de detalhe', {
            contaId,
            cobrancaId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return privateJson(body, {
        maxAgeSeconds: CHARGE_DETAIL_CACHE_SECONDS,
        staleWhileRevalidateSeconds: CHARGE_DETAIL_STALE_SECONDS,
        cacheState: 'MISS',
      });
    };

    // Buscar cobrança com relações necessárias - MULTI-TENANT: filtra por contaId via aluno
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: true,
            plano: true,
            turma: {
              include: {
                sala: true,
                modalidade: true,
              },
            },
          },
        },
        pagamentos: {
          orderBy: { createdAt: 'desc' },
        },
        charge: {
          select: {
            status: true,
            asaasStatus: true,
            invoiceUrl: true,
            billingType: true,
          },
        },
      },
    });

    // Se não encontrar em Cobranca, tentar buscar em Charge (standalone) - MULTI-TENANT
    if (!cobranca) {
      const charge = await prisma.charge.findFirst({
        where: { id, contaId },
        include: {
          customer: true,
        },
      });

      if (charge) {
        let remoteAsaasData = null;
        const standaloneAsaasPaymentId =
          typeof charge.asaasPaymentId === 'string' && charge.asaasPaymentId.trim().length > 0
            ? charge.asaasPaymentId
            : null;
        const shouldFetchStandaloneRemote = Boolean(
          standaloneAsaasPaymentId &&
            shouldFetchStandaloneAsaasDetail({ forceRefresh, isAsaasActive: asaasActive, charge }),
        );

        if (shouldFetchStandaloneRemote) {
          recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
          try {
            remoteAsaasData = await getPayment(standaloneAsaasPaymentId!, { contaId: charge.contaId });
          } catch (error) {
            if (!(error instanceof AsaasEnvError)) {
              console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas (Charge):', error);
            }
          }
        } else {
          recordAsaasReadDecision('cobranca_detail', 'local');
        }

        const asaasData = remoteAsaasData ?? buildStandaloneAsaasData(charge);
        const participantPaymentRules = await findEventPaymentRulesForCharge({
          contaId,
          chargeId: charge.id,
          installmentPlanId: charge.standaloneInstallmentPlanId,
          asaasPaymentId: charge.asaasPaymentId,
        });
        const effectivePaymentRules: ChargePaymentRules | null =
          charge.interestValue != null || charge.fineValue != null || charge.discountValue != null
            ? {
                interestValue: charge.interestValue == null ? null : Number(charge.interestValue),
                fineValue: charge.fineValue == null ? null : Number(charge.fineValue),
                fineType: charge.fineType,
                discountValue: charge.discountValue == null ? null : Number(charge.discountValue),
                discountType: charge.discountType,
                discountDueDateLimitDays: charge.discountDueDateLimitDays,
              }
            : participantPaymentRules;

        const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData ?? asaasData);

        const effectiveStatus = resolveStandaloneDisplayedStatus({
          localChargeStatus: charge.status,
          remotePaymentStatus,
          dueDate: charge.dueDate,
        });

        const effectivePaymentDate =
          remoteAsaasData?.paymentDate ?? remoteAsaasData?.clientPaymentDate ?? null;
        const effectiveLiquidacaoStatus = resolveStandaloneLiquidacaoStatus({
          displayedStatus: effectiveStatus,
          remotePaymentStatus,
          creditDate: remoteAsaasData?.creditDate ?? null,
          billingType: remoteAsaasData?.billingType ?? charge.billingType ?? null,
        }) ?? charge.liquidacaoStatus ?? null;
        const standaloneDisplayStatus = resolveCobrancaDisplayStatus({
          status: effectiveStatus as StatusCobranca,
          liquidacaoStatus: effectiveLiquidacaoStatus,
          asaasStatus: remotePaymentStatus,
        });
        const effectiveFormaPagamento =
          mapBillingTypeToFormaPagamento(
            (remoteAsaasData?.billingType as string | null | undefined) ?? charge.billingType,
          ) ?? 'INDEFINIDO';
        const standaloneTipo = resolveStandaloneChargeTipo({
          standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
          standaloneSubscriptionId: charge.standaloneSubscriptionId,
          externalReference: charge.externalReference,
          familyGroupId: charge.familyGroupId,
          description: charge.description,
        });
        const standaloneDescricao =
          charge.description ??
          (standaloneTipo === 'RECORRENTE'
            ? 'Assinatura recorrente'
            : standaloneTipo === 'PARCELADA'
              ? 'Parcela'
              : 'Cobrança avulsa');

        return respondDetail(
          cobrancaDetailResultDTOSchema.parse(
            mapCobrancaDetailResultToDTO({
              success: true,
              data: {
                id: charge.id,
                tipo: standaloneTipo,
                status: effectiveStatus,
                valor: charge.value != null ? Number(charge.value) : 0,
                vencimento: charge.dueDate?.toISOString() ?? new Date().toISOString(),
                dataPagamento: effectivePaymentDate,
                descricao: standaloneDescricao,
                formaPagamento: effectiveFormaPagamento,
                atrasado: effectiveStatus === 'ATRASADO',
                asaasPaymentId: charge.asaasPaymentId,
                valorBruto: charge.value != null ? Number(charge.value) : 0,
                valorLiquido: toNullableNumber(remoteAsaasData?.netValue ?? asaasData?.netValue),
                taxaAsaas:
                  (remoteAsaasData?.netValue ?? asaasData?.netValue) != null &&
                  (remoteAsaasData?.value ?? asaasData?.value) != null
                    ? Number(remoteAsaasData?.value ?? asaasData?.value) -
                      Number(remoteAsaasData?.netValue ?? asaasData?.netValue)
                    : null,
                ...mapPaymentRulesToCobrancaFields(effectivePaymentRules),
                liquidacaoStatus: effectiveLiquidacaoStatus,
                displayStatus: standaloneDisplayStatus,
                invoiceUrl:
                  typeof charge.invoiceUrl === 'string'
                    ? charge.invoiceUrl
                    : (remoteAsaasData?.invoiceUrl ?? null),
                matricula: {
                  id: charge.id,
                  codigo: 'AVULSA',
                  aluno: {
                    id: charge.customerId ?? charge.id,
                    nome: charge.payerName ?? 'Cliente',
                    cpf: null,
                    email: null,
                    telefone: null,
                    responsavelFinanceiro: null,
                  },
                  plano: {
                    id: 'avulsa',
                    nome: 'Cobrança Avulsa',
                    periodicidade: 'AVULSA',
                  },
                  combo: null,
                },
                pagamentos: [],
                asaasData,
                origin: 'STANDALONE',
              },
            }),
          ),
        );
      }

      const operationalCharge = await resolveOperationalChargePayment(contaId, id);
      if (operationalCharge) {
        let remoteAsaasData = null;
        const eventAsaasPaymentId =
          typeof operationalCharge.asaasPaymentId === 'string' &&
          operationalCharge.asaasPaymentId.trim().length > 0
            ? operationalCharge.asaasPaymentId
            : null;
        const shouldFetchEventRemote = Boolean(eventAsaasPaymentId && asaasActive);

        if (shouldFetchEventRemote && eventAsaasPaymentId) {
          recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
          try {
            remoteAsaasData = await getPayment(eventAsaasPaymentId, { contaId });
          } catch (error) {
            if (!(error instanceof AsaasEnvError)) {
              console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas (Event):', error);
            }
          }
        } else {
          recordAsaasReadDecision('cobranca_detail', 'local');
        }

        const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData);
        const localDisplayStatus = mapOperationalStatusToCobrancaDisplay(operationalCharge.localStatus);
        const effectiveStatus = remotePaymentStatus
          ? mapAsaasPaymentStatusToCobranca(remotePaymentStatus, {
              dueDate: operationalCharge.dueDate,
            })
          : localDisplayStatus;
        const effectivePaymentDate =
          remoteAsaasData?.paymentDate ??
          remoteAsaasData?.clientPaymentDate ??
          operationalCharge.paidAt?.toISOString() ??
          null;
        const effectiveLiquidacaoStatus = resolveStandaloneLiquidacaoStatus({
          displayedStatus: effectiveStatus,
          remotePaymentStatus,
          creditDate: remoteAsaasData?.creditDate ?? null,
          billingType: remoteAsaasData?.billingType ?? operationalCharge.billingType ?? null,
        });
        const eventDisplayStatus = resolveCobrancaDisplayStatus({
          status: effectiveStatus as StatusCobranca,
          liquidacaoStatus: effectiveLiquidacaoStatus,
          asaasStatus: remotePaymentStatus,
        });
        const effectiveFormaPagamento =
          mapBillingTypeToFormaPagamento(
            (remoteAsaasData?.billingType as string | null | undefined) ??
              operationalCharge.billingType,
          ) ?? 'INDEFINIDO';
        const asaasData =
          remoteAsaasData ??
          (eventAsaasPaymentId
            ? {
                id: eventAsaasPaymentId,
                status: operationalCharge.localStatus === 'PAID' ? 'CONFIRMED' : 'PENDING',
                billingType: operationalCharge.billingType,
                invoiceUrl: operationalCharge.invoiceUrl,
              }
            : null);

        return respondDetail(
          cobrancaDetailResultDTOSchema.parse(
            mapCobrancaDetailResultToDTO({
              success: true,
              data: {
                id: operationalCharge.operationalId,
                tipo: 'EVENTO',
                status: effectiveStatus,
                valor: operationalCharge.value,
                vencimento:
                  operationalCharge.dueDate?.toISOString() ??
                  new Date().toISOString(),
                dataPagamento: effectivePaymentDate,
                descricao: operationalCharge.description,
                formaPagamento: effectiveFormaPagamento,
                atrasado: effectiveStatus === 'ATRASADO',
                asaasPaymentId: operationalCharge.asaasPaymentId,
                valorBruto: operationalCharge.value,
                valorLiquido: toNullableNumber(remoteAsaasData?.netValue),
                taxaAsaas:
                  remoteAsaasData?.netValue != null && remoteAsaasData?.value != null
                    ? Number(remoteAsaasData.value) - Number(remoteAsaasData.netValue)
                    : null,
                liquidacaoStatus: effectiveLiquidacaoStatus,
                displayStatus: eventDisplayStatus,
                invoiceUrl:
                  operationalCharge.invoiceUrl ??
                  remoteAsaasData?.invoiceUrl ??
                  null,
                eventId: operationalCharge.eventId,
                matricula: {
                  id: operationalCharge.operationalId,
                  codigo: 'EVENTO',
                  aluno: {
                    id: operationalCharge.alunoId ?? operationalCharge.operationalId,
                    nome: operationalCharge.payerName,
                    cpf: null,
                    email: null,
                    telefone: null,
                    responsavelFinanceiro: null,
                  },
                  plano: {
                    id: 'evento',
                    nome: 'Evento',
                    periodicidade: 'AVULSA',
                  },
                  combo: null,
                },
                pagamentos: [],
                asaasData,
                origin: 'EVENT',
                eventDetails: operationalCharge.eventDetails ?? null,
              },
            }),
          ),
        );
      }

      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    // Calcular se está atrasado (comparação date-only para evitar fuso)
    const toDateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const hoje = toDateOnly(new Date());
    const vencimento = toDateOnly(new Date(cobranca.vencimento));
    const atrasado = cobranca.status !== 'PAGO' && cobranca.status !== 'CANCELADO' && vencimento < hoje;

    // Buscar informações adicionais do Asaas se houver asaasPaymentId
    let remoteAsaasData = null;
    const contaIdForAsaas = cobranca.matricula?.aluno?.contaId;
    const academicAsaasPaymentId =
      typeof cobranca.asaasPaymentId === 'string' && cobranca.asaasPaymentId.trim().length > 0
        ? cobranca.asaasPaymentId
        : null;
    const shouldFetchAcademicRemote = Boolean(
      academicAsaasPaymentId &&
        shouldFetchAcademicAsaasDetail({
          forceRefresh,
          isAsaasActive: asaasActive && Boolean(contaIdForAsaas),
          cobranca: cobranca as unknown as Record<string, unknown>,
        }) &&
        contaIdForAsaas,
    );

    if (shouldFetchAcademicRemote) {
      recordAsaasReadDecision('cobranca_detail', forceRefresh ? 'fresh_remote' : 'remote');
      try {
        remoteAsaasData = await getPayment(academicAsaasPaymentId!, { contaId: contaIdForAsaas! });
      } catch (error) {
        if (error instanceof AsaasEnvError) {
          console.warn('[GET /api/cobrancas/[id]] Integração Asaas indisponível:', error.message);
        } else {
          console.error('[GET /api/cobrancas/[id]] Erro ao buscar dados do Asaas:', error);
        }
      }
    } else {
      recordAsaasReadDecision('cobranca_detail', 'local');
    }

    const effectiveCobranca = cobranca;

    const asaasData =
      remoteAsaasData ?? buildAcademicAsaasData(effectiveCobranca as unknown as Record<string, unknown>);
    const remotePaymentStatus = getEffectiveRemotePaymentStatus(remoteAsaasData ?? asaasData);

    const remoteBillingTypeForForma =
      (remoteAsaasData?.billingType as string | null | undefined) ??
      (asaasData?.billingType as string | null | undefined);
    const effectiveFormaPagamento =
      typeof remoteBillingTypeForForma === 'string' &&
      remoteBillingTypeForForma.trim().toUpperCase() === 'RECEIVED_IN_CASH'
        ? 'INDEFINIDO'
        : cobranca.formaPagamento && cobranca.formaPagamento !== 'INDEFINIDO'
          ? cobranca.formaPagamento
          : (mapBillingTypeToFormaPagamento(remoteBillingTypeForForma) ?? cobranca.formaPagamento);

    // Buscar InstallmentPlan se cobrança for do tipo PARCELADA
    let installmentPlanId: string | null = null;
    if (cobranca.tipo === 'PARCELADA' && cobranca.matriculaId) {
      const installmentPlan = await prisma.installmentPlan.findFirst({
        where: { matriculaId: cobranca.matriculaId },
        select: { id: true },
      });
      installmentPlanId = installmentPlan?.id ?? null;
    }

    // Buscar Subscription se cobrança for do tipo MENSALIDADE ou RECORRENTE
    let subscriptionId: string | null = null;
    if ((cobranca.tipo === 'MENSALIDADE' || cobranca.tipo === 'RECORRENTE') && cobranca.matriculaId) {
      const subscription = await prisma.subscription.findFirst({
        where: { matriculaId: cobranca.matriculaId },
        select: { id: true },
      });
      subscriptionId = subscription?.id ?? null;
    }

    const effectiveStatus = resolveAcademicDisplayedStatus({
      localCobrancaStatus: effectiveCobranca.status,
      localChargeStatus: effectiveCobranca.charge?.status ?? null,
      remotePaymentStatus,
      dueDate: effectiveCobranca.vencimento,
    });

    const storedLiquidacao = (effectiveCobranca as unknown as { liquidacaoStatus?: LiquidacaoStatus | null })
      .liquidacaoStatus;
    const computedLiquidacaoStatus = resolveLiquidacaoFromAsaasPayment({
      asaasStatus: remotePaymentStatus,
      creditDate:
        (remoteAsaasData?.creditDate as string | null | undefined) ??
        (asaasData?.creditDate as string | null | undefined) ??
        null,
      billingType:
        (remoteAsaasData?.billingType as string | null | undefined) ??
        (asaasData?.billingType as string | null | undefined) ??
        null,
    });
    const shouldPreferComputedLiquidacao =
      Boolean(remoteAsaasData) ||
      ['RECEIVED_IN_CASH', 'CONFIRMED', 'RECEIVED', 'DUNNING_RECEIVED'].includes(
        String(remotePaymentStatus ?? '').toUpperCase(),
      );
    const effectiveLiquidacaoStatus: LiquidacaoStatus =
      shouldPreferComputedLiquidacao
        ? computedLiquidacaoStatus
        : (storedLiquidacao ?? computedLiquidacaoStatus);

    const displayStatus = resolveCobrancaDisplayStatus({
      status: effectiveStatus as StatusCobranca,
      liquidacaoStatus: effectiveLiquidacaoStatus,
      asaasStatus: remotePaymentStatus,
    });

    const { charge: _academicCharge, ...cobrancaDetail } = effectiveCobranca;

    return respondDetail(
      cobrancaDetailResultDTOSchema.parse(
        mapCobrancaDetailResultToDTO({
          success: true,
          data: {
            ...cobrancaDetail,
            formaPagamento: effectiveFormaPagamento,
            status: effectiveStatus,
            valor: Number(effectiveCobranca.valor),
            atrasado: effectiveStatus === 'ATRASADO' || (effectiveStatus === 'PENDENTE' && atrasado),
            asaasData,
            installmentPlanId,
            subscriptionId,
            valorBruto: Number(effectiveCobranca.valor),
            valorLiquido: toNullableNumber(
              (effectiveCobranca as unknown as { asaasNetValue?: unknown }).asaasNetValue,
            ),
            taxaAsaas: toNullableNumber(
              (effectiveCobranca as unknown as { asaasFeeValue?: unknown }).asaasFeeValue,
            ),
            liquidacaoStatus: effectiveLiquidacaoStatus,
            displayStatus,
          },
        }),
      ),
    );
  } catch (error) {
    const correlationId = logFinanceApiError('GET /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao buscar detalhes da cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

/**
 * PUT /api/cobrancas/[id]
 * Atualiza dados de uma cobrança (valor, vencimento, juros, multa, desconto)
 * Apenas permite edição se status for PENDENTE ou A_VENCER
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    const { contaId } = user;

    const { id } = rawParams;
    const body = await req.json();

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    // Buscar cobrança atual - MULTI-TENANT: filtra por contaId via aluno
    const cobrancaAtual = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: true,
          },
        },
      },
    });

    const chargeAtual = !cobrancaAtual
      ? await prisma.charge.findFirst({
          where: { id, contaId },
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            value: true,
            dueDate: true,
            description: true,
            billingType: true,
            invoiceUrl: true,
            standaloneInstallmentPlanId: true,
            standaloneSubscriptionId: true,
          },
        })
      : null;

    if (!cobrancaAtual && !chargeAtual) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    // Extrair campos editáveis
    const {
      valor,
      vencimento,
      descricao,
      formaPagamento, // não é atualizado por esta rota; existe rota dedicada
      // Campos detalhados de juros
      jurosPercentual,
      jurosValorFixo,
      juros,
      // Campos detalhados de multa
      multaTipo,
      multaPercentual,
      multaValorFixo,
      multa,
      // Campos detalhados de desconto
      descontoTipo,
      descontoPercentual,
      descontoValorFixo,
      descontoPrazoMaximo,
      desconto,
      // Valor final
      valorFinal,
    } = body;

    // Bloquear atualização de formaPagamento por esta rota para manter regras/auditoria
    if (typeof formaPagamento !== 'undefined') {
      return NextResponse.json(
        {
          success: false,
          error: 'Use /api/cobrancas/[id]/forma-pagamento para alterar a forma de pagamento.',
        },
        { status: 400 },
      );
    }

    const parseDateOnly = (value: string | Date) => {
      if (value instanceof Date) return value;
      // Espera YYYY-MM-DD – cria data estável sem shift de fuso
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T12:00:00Z`);
      }
      const d = new Date(value);
      return d;
    };

    const normalizeTipo = (tipo?: string | null) => {
      if (!tipo) {
        return undefined;
      }

      const upper = tipo.toUpperCase();

      if (upper === 'FIXO' || upper === 'VALOR_FIXO') {
        return 'VALOR_FIXO';
      }

      if (upper === 'PERCENTUAL' || upper === 'PERCENTAGE') {
        return 'PERCENTUAL';
      }

      return upper;
    };

    const normalizedMultaTipo = normalizeTipo(multaTipo);
    const normalizedDescontoTipo = normalizeTipo(descontoTipo);
    const canonicalDescontoPrazoMaximo = resolveCanonicalDiscountDueDateLimit({
      descontoPrazoMaximo,
      normalizedDescontoTipo,
      descontoPercentual,
      descontoValorFixo,
      desconto,
    });
    let asaasCommandJobId: string | null = null;

    // Validações básicas de domínio
    const isNeg = (n: unknown) => typeof n === 'number' && n < 0;
    if (typeof valor !== 'undefined' && isNeg(Number(valor))) {
      return NextResponse.json(
        { success: false, error: 'Valor não pode ser negativo' },
        { status: 400 },
      );
    }
    const percentInRange = (v: unknown) =>
      typeof v === 'number' && v >= 0 && v <= 100;
    if (typeof jurosPercentual !== 'undefined' && !percentInRange(Number(jurosPercentual))) {
      return NextResponse.json(
        { success: false, error: 'Juros percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (typeof multaPercentual !== 'undefined' && !percentInRange(Number(multaPercentual))) {
      return NextResponse.json(
        { success: false, error: 'Multa percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (
      typeof descontoPercentual !== 'undefined' &&
      !percentInRange(Number(descontoPercentual))
    ) {
      return NextResponse.json(
        { success: false, error: 'Desconto percentual deve estar entre 0 e 100' },
        { status: 400 },
      );
    }
    if (
      isNeg(Number(jurosValorFixo)) ||
      isNeg(Number(multaValorFixo)) ||
      isNeg(Number(descontoValorFixo))
    ) {
      return NextResponse.json(
        { success: false, error: 'Valores fixos não podem ser negativos' },
        { status: 400 },
      );
    }

    if (chargeAtual) {
      const localPolicy = evaluatePaymentActionPolicy({
        entityType: 'CHARGE',
        origin: chargeAtual.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : chargeAtual.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
        localStatus: chargeAtual.status,
        billingType: chargeAtual.billingType,
        hasAsaasPaymentId: Boolean(chargeAtual.asaasPaymentId),
        hasInvoiceUrl: Boolean(chargeAtual.invoiceUrl),
        isInstallmentPayment: Boolean(chargeAtual.standaloneInstallmentPlanId),
        isSubscriptionPayment: Boolean(chargeAtual.standaloneSubscriptionId),
      });

      if (!localPolicy.canEdit) {
        return policyBlockedError({
          action: 'EDIT',
          decision: localPolicy.actions.EDIT,
          status: chargeAtual.status,
          source: 'LOCAL',
        });
      }

      if (isAsaasEnabled() && chargeAtual.asaasPaymentId) {
        const currentPayment = await readPaymentFullPreflight(chargeAtual.asaasPaymentId, { contaId });
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'CHARGE',
          origin: chargeAtual.standaloneInstallmentPlanId
            ? 'INSTALLMENT'
            : chargeAtual.standaloneSubscriptionId
              ? 'SUBSCRIPTION'
              : 'STANDALONE',
          localStatus: chargeAtual.status,
          asaasStatus: currentPayment.status,
          billingType: currentPayment.billingType ?? chargeAtual.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(chargeAtual.invoiceUrl || currentPayment.invoiceUrl),
          isInstallmentPayment: Boolean(chargeAtual.standaloneInstallmentPlanId),
          isSubscriptionPayment: Boolean(chargeAtual.standaloneSubscriptionId),
        });

        if (!remotePolicy.canEdit) {
          return policyBlockedError({
            action: 'EDIT',
            decision: remotePolicy.actions.EDIT,
            status: currentPayment.status,
            source: 'ASAAS',
          });
        }

        const updatePayload = buildAsaasPaymentUpdatePayload({
          currentPayment,
          changes: {
            valor,
            vencimento,
            descricao,
            jurosPercentual,
            multaValorFixo,
            multaPercentual,
            descontoPercentual,
            descontoValorFixo,
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            desconto,
            normalizedMultaTipo,
            normalizedDescontoTipo,
          },
        });

        const { commandJobId } = await runAsaasPaymentCommand({
          contaId,
          type: 'PAYMENT_UPDATE_COMMAND',
          entityType: 'CHARGE',
          entityId: chargeAtual.id,
          asaasPaymentId: chargeAtual.asaasPaymentId,
          actorId: user.id,
          chargeId: chargeAtual.id,
          providerStatus: currentPayment.status,
          metadata: {
            source: 'PUT /api/cobrancas/[id]',
            changes: {
              valor,
              vencimento,
              descricao,
              jurosPercentual,
              multaTipo: normalizedMultaTipo,
              multaPercentual,
              descontoTipo: normalizedDescontoTipo,
              descontoPercentual,
              descontoValorFixo,
              descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            },
          },
          run: () => updatePayment(chargeAtual.asaasPaymentId!, updatePayload, { contaId }),
        });
        asaasCommandJobId = commandJobId;
      }

      const chargeAtualizada = await prisma.charge.update({
        where: { id: chargeAtual.id },
        data: {
          ...(valor !== undefined && { value: Number(valor) }),
          ...(vencimento !== undefined && { dueDate: parseDateOnly(vencimento) }),
          ...(descricao !== undefined && { description: descricao }),
          updatedAt: new Date(),
        },
      });

      await auditLogService.record({
        contaId,
        action: 'finance.charge.updated',
        entity: { type: 'Charge', id: chargeAtual.id },
        metadata: {
          asaasPaymentId: chargeAtual.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          previousStatus: chargeAtual.status,
          changes: {
            valor,
            vencimento,
            descricao,
          },
          updatedBy: user.id,
        },
      });

      await invalidateChargeResourceCache({
        contaId,
        cobrancaId: chargeAtual.id,
        reason: 'charge-update',
      });

      return NextResponse.json(
        cobrancaMutationResultDTOSchema.parse(
          mapCobrancaMutationResultToDTO({
            success: true,
            data: chargeAtualizada,
            message:
              'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
          }),
        ),
        { status: 202 },
      );
    }

    if (!cobrancaAtual) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada' },
        { status: 404 },
      );
    }

    const localPolicy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: resolveAcademicPaymentOrigin(cobrancaAtual.tipo),
      localStatus: cobrancaAtual.status,
      billingType: cobrancaAtual.formaPagamento,
      hasAsaasPaymentId: Boolean(cobrancaAtual.asaasPaymentId),
      hasInvoiceUrl: Boolean((cobrancaAtual as unknown as { charge?: { invoiceUrl?: string | null } }).charge?.invoiceUrl),
      isInstallmentPayment: cobrancaAtual.tipo === 'PARCELADA',
      isSubscriptionPayment: cobrancaAtual.tipo === 'RECORRENTE',
    });

    if (!localPolicy.canEdit) {
      return policyBlockedError({
        action: 'EDIT',
        decision: localPolicy.actions.EDIT,
        status: cobrancaAtual.status,
        source: 'LOCAL',
      });
    }

    // Se tiver asaasPaymentId, validar/atualizar no Asaas ANTES de mutar o banco local.
    // Se KYC não estiver aprovado, a operação falha sem side-effects locais.
    if (isAsaasEnabled() && cobrancaAtual.asaasPaymentId) {
      const contaIdForAsaas = cobrancaAtual.matricula?.aluno?.contaId;

      if (contaIdForAsaas) {
        const currentPayment = await readPaymentFullPreflight(cobrancaAtual.asaasPaymentId, { contaId: contaIdForAsaas });
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'COBRANCA',
          origin: resolveAcademicPaymentOrigin(cobrancaAtual.tipo),
          localStatus: cobrancaAtual.status,
          asaasStatus: currentPayment.status,
          billingType: currentPayment.billingType ?? cobrancaAtual.formaPagamento,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(currentPayment.invoiceUrl),
          isInstallmentPayment: cobrancaAtual.tipo === 'PARCELADA',
          isSubscriptionPayment: cobrancaAtual.tipo === 'RECORRENTE',
        });

        if (!remotePolicy.canEdit) {
          return policyBlockedError({
            action: 'EDIT',
            decision: remotePolicy.actions.EDIT,
            status: currentPayment.status,
            source: 'ASAAS',
          });
        }

        const updatePayload = buildAsaasPaymentUpdatePayload({
          currentPayment,
          changes: {
            valor,
            vencimento,
            descricao,
            jurosPercentual,
            multaValorFixo,
            multaPercentual,
            descontoPercentual,
            descontoValorFixo,
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            desconto,
            normalizedMultaTipo,
            normalizedDescontoTipo,
          },
        });

        const { commandJobId } = await runAsaasPaymentCommand({
          contaId: contaIdForAsaas,
          type: 'PAYMENT_UPDATE_COMMAND',
          entityType: 'COBRANCA',
          entityId: cobrancaAtual.id,
          asaasPaymentId: cobrancaAtual.asaasPaymentId,
          actorId: user.id,
          cobrancaId: cobrancaAtual.id,
          providerStatus: currentPayment.status,
          metadata: {
            source: 'PUT /api/cobrancas/[id]',
            changes: {
              valor,
              vencimento,
              descricao,
              jurosPercentual,
              multaTipo: normalizedMultaTipo,
              multaPercentual,
              descontoTipo: normalizedDescontoTipo,
              descontoPercentual,
              descontoValorFixo,
              descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
            },
          },
          run: () => updatePayment(cobrancaAtual.asaasPaymentId!, updatePayload, { contaId: contaIdForAsaas }),
        });
        asaasCommandJobId = commandJobId;
      }
    }

    // Atualizar cobrança - MULTI-TENANT: usar transação para garantir atomicidade
    const cobrancaAtualizada = await prisma.$transaction(async (tx) => {
      // Verificar novamente se o registro pertence à conta (dentro da transação)
      const verified = await tx.cobranca.findFirst({
        where: { id, matricula: { aluno: { contaId } } },
        select: { id: true },
      });
      if (!verified) {
        throw new Error('Cobrança não encontrada');
      }
      return tx.cobranca.update({
        where: { id },
        data: {
          ...(valor !== undefined && { valor }),
          ...(vencimento !== undefined && { vencimento: parseDateOnly(vencimento) }),
          ...(descricao !== undefined && { descricao }),
          // Atualizar campos de juros
          ...(jurosPercentual !== undefined && { jurosPercentual }),
          ...(jurosValorFixo !== undefined && { jurosValorFixo }),
          ...(juros !== undefined && { juros }),
          // Atualizar campos de multa
          ...(normalizedMultaTipo !== undefined && { multaTipo: normalizedMultaTipo }),
          ...(multaPercentual !== undefined && { multaPercentual }),
          ...(multaValorFixo !== undefined && { multaValorFixo }),
          ...(multa !== undefined && { multa }),
          // Atualizar campos de desconto
          ...(normalizedDescontoTipo !== undefined && { descontoTipo: normalizedDescontoTipo }),
          ...(descontoPercentual !== undefined && { descontoPercentual }),
          ...(descontoValorFixo !== undefined && { descontoValorFixo }),
          ...(canonicalDescontoPrazoMaximo !== undefined && {
            descontoPrazoMaximo: canonicalDescontoPrazoMaximo,
          }),
          ...(desconto !== undefined && { desconto }),
          // Valor final
          ...(valorFinal !== undefined && { valorFinal }),
        },
        include: {
          matricula: {
            include: {
              aluno: true,
            },
          },
        },
      });
    });

    await invalidateChargeResourceCache({
      contaId,
      cobrancaId: id,
      reason: 'cobranca-update',
    });

    return NextResponse.json(
      cobrancaMutationResultDTOSchema.parse(
        mapCobrancaMutationResultToDTO({
          success: true,
          data: cobrancaAtualizada,
          ...(asaasCommandJobId ? { commandJobId: asaasCommandJobId } : {}),
          message:
            'Alteração enviada para processamento financeiro da Alusa. A atualização pode levar alguns instantes para refletir em toda a aplicação.',
        }),
      ),
      { status: 202 },
    );
  } catch (error) {
    // KYC não aprovado → 409
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { success: false, error: 'KYC_NAO_APROVADO' },
        { status: 409 },
      );
    }
    if (error instanceof AsaasEnvError) {
      return NextResponse.json(
        { success: false, error: 'ASAAS_INDISPONIVEL' },
        { status: 503 },
      );
    }
    const correlationId = logFinanceApiError('PUT /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}

/**
 * DELETE /api/cobrancas/[id]
 * Solicita cancelamento de uma cobrança quando ela ainda está em aberto no fluxo financeiro
 * Não remove localmente: aguarda confirmação via webhook do Asaas.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    const { contaId } = user;

    const { id } = rawParams;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID da cobrança é obrigatório' },
        { status: 400 },
      );
    }

    // Buscar cobrança acadêmica - MULTI-TENANT: filtra por contaId via aluno
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
      include: {
        matricula: {
          include: {
            aluno: {
              select: { contaId: true },
            },
          },
        },
      },
    });

    // Se não encontrou cobrança acadêmica, tentar Charge (standalone)
    if (!cobranca) {
      const charge = await prisma.charge.findFirst({
        where: { id, contaId },
        select: {
          id: true,
          status: true,
          asaasPaymentId: true,
          externalReference: true,
          billingType: true,
          invoiceUrl: true,
          standaloneInstallmentPlanId: true,
          standaloneSubscriptionId: true,
        },
      });

      if (!charge) {
        const operationalCharge = await resolveOperationalChargePayment(contaId, id);
        if (!operationalCharge) {
          return NextResponse.json(
            { success: false, error: 'Cobrança não encontrada' },
            { status: 404 },
          );
        }

        if (!isAsaasEnabled() || !operationalCharge.asaasPaymentId) {
          return NextResponse.json(
            { success: false, error: 'Cobrança sem integração Asaas' },
            { status: 400 },
          );
        }

        const localPolicy = evaluatePaymentActionPolicy({
          entityType: 'COBRANCA',
          origin: 'EVENT',
          localStatus: operationalCharge.localStatus,
          billingType: operationalCharge.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(operationalCharge.invoiceUrl),
        });

        if (!localPolicy.canCancel) {
          return policyBlockedError({
            action: 'CANCEL',
            decision: localPolicy.actions.CANCEL,
            status: operationalCharge.localStatus,
            source: 'LOCAL',
          });
        }

        let asaasCommandJobId: string | null = null;
        let remoteStatusBeforeCommand: string | null = null;

        try {
          const payment = await readPaymentFullPreflight(operationalCharge.asaasPaymentId, { contaId });
          const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
          remoteStatusBeforeCommand = effectivePaymentStatus;
          const remotePolicy = evaluatePaymentActionPolicy({
            entityType: 'COBRANCA',
            origin: 'EVENT',
            localStatus: operationalCharge.localStatus,
            asaasStatus: effectivePaymentStatus,
            billingType: payment.billingType ?? operationalCharge.billingType,
            hasAsaasPaymentId: true,
            hasInvoiceUrl: Boolean(operationalCharge.invoiceUrl || payment.invoiceUrl),
          });

          if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
            return policyBlockedError({
              action: 'CANCEL',
              decision: remotePolicy.actions.CANCEL,
              status: effectivePaymentStatus,
              source: 'ASAAS',
            });
          }

          if (effectivePaymentStatus === 'DELETED') {
            let localStateConverged = false;
            try {
              localStateConverged = await applyImmediateDeletedPaymentConvergence(contaId, payment);
              await convergeLocalCanceledPayment({
                contaId,
                chargeId: operationalCharge.operationalId,
                asaasPaymentId: operationalCharge.asaasPaymentId,
                actorId: user.id,
                reason: 'Cobrança já estava cancelada no Asaas',
              });
              localStateConverged = true;
            } catch (webhookError) {
              console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (event)', {
                operationalId: operationalCharge.operationalId,
                asaasPaymentId: operationalCharge.asaasPaymentId,
                error: webhookError instanceof Error ? webhookError.message : String(webhookError),
              });
            }

            return NextResponse.json(
              cobrancaMutationResultDTOSchema.parse(
                mapCobrancaMutationResultToDTO({
                  success: true,
                  pending: !localStateConverged,
                  message: localStateConverged
                    ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                    : 'Cobrança já estava cancelada no Asaas.',
                }),
              ),
              { status: localStateConverged ? 200 : 202 },
            );
          }
        } catch (readErr) {
          if (readErr instanceof KycNotApprovedError) throw readErr;
          console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou (event), seguindo com delete', {
            asaasPaymentId: operationalCharge.asaasPaymentId,
            error: readErr instanceof Error ? readErr.message : String(readErr),
          });
        }

        const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
          contaId,
          type: 'PAYMENT_CANCEL_COMMAND',
          entityType: 'CHARGE',
          entityId: operationalCharge.operationalId,
          asaasPaymentId: operationalCharge.asaasPaymentId,
          actorId: user.id,
          providerStatus: remoteStatusBeforeCommand,
          metadata: {
            source: 'DELETE /api/cobrancas/[id]',
            origin: 'EVENT',
            previousLocalStatus: operationalCharge.localStatus,
          },
          run: () => deletePayment(operationalCharge.asaasPaymentId!, { contaId }),
        });
        asaasCommandJobId = commandJobId;

        let localStateConverged = false;
          try {
            const webhookResult = await handlePaymentWebhook(
              contaId,
              buildDeletedPaymentWebhookPayload(deletedPayment),
            );
            localStateConverged = webhookResult.success;
          } catch (webhookError) {
          console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (event)', {
            operationalId: operationalCharge.operationalId,
            asaasPaymentId: operationalCharge.asaasPaymentId,
            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
          });
        }

        if (!localStateConverged) {
          try {
            await syncPaymentStateFromAsaas({
              contaId,
              asaasPaymentId: operationalCharge.asaasPaymentId,
              eventName: 'PAYMENT_DELETED',
            });
          } catch (syncError) {
            console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (event)', {
              operationalId: operationalCharge.operationalId,
              asaasPaymentId: operationalCharge.asaasPaymentId,
              error: syncError instanceof Error ? syncError.message : String(syncError),
            });
          }
        }

        await convergeLocalCanceledPayment({
          contaId,
          chargeId: operationalCharge.operationalId,
          asaasPaymentId: operationalCharge.asaasPaymentId,
          actorId: user.id,
          reason: 'Cancelada no Asaas pelo endpoint de cobranças',
        });
        localStateConverged = true;

        await auditLogService.record({
          contaId,
          action: 'finance.charge.cancel_requested',
          entity: { type: 'Charge', id: operationalCharge.operationalId },
          metadata: {
            asaasPaymentId: operationalCharge.asaasPaymentId,
            commandJobId: asaasCommandJobId,
            origin: 'EVENT',
            statusBefore: operationalCharge.localStatus,
            requestedBy: user.id,
          },
        });

        await invalidateChargeResourceCache({
          contaId,
          cobrancaId: operationalCharge.operationalId,
          reason: 'charge-delete-event',
        });

        return NextResponse.json(
          cobrancaMutationResultDTOSchema.parse(
            mapCobrancaMutationResultToDTO({
              success: true,
              pending: !localStateConverged,
              message: localStateConverged
                ? 'Cobrança cancelada e sincronizada com o Asaas.'
                : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
            }),
          ),
          { status: localStateConverged ? 200 : 202 },
        );
      }

      if (!isAsaasEnabled() || !charge.asaasPaymentId) {
        return NextResponse.json(
          { success: false, error: 'Cobrança sem integração Asaas' },
          { status: 400 },
        );
      }

      const localPolicy = evaluatePaymentActionPolicy({
        entityType: 'CHARGE',
        origin: charge.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : charge.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
        localStatus: charge.status,
        billingType: charge.billingType,
        hasAsaasPaymentId: Boolean(charge.asaasPaymentId),
        hasInvoiceUrl: Boolean(charge.invoiceUrl),
        isInstallmentPayment: Boolean(charge.standaloneInstallmentPlanId),
        isSubscriptionPayment: Boolean(charge.standaloneSubscriptionId),
      });

      if (!localPolicy.canCancel) {
        return policyBlockedError({
          action: 'CANCEL',
          decision: localPolicy.actions.CANCEL,
          status: charge.status,
          source: 'LOCAL',
        });
      }

      let asaasCommandJobId: string | null = null;
      let remoteStatusBeforeCommand: string | null = null;

      // Read-before-write: conferir status atual no Asaas (tolerante a falha)
      try {
        const payment = await readPaymentFullPreflight(charge.asaasPaymentId, { contaId });
        const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
        remoteStatusBeforeCommand = effectivePaymentStatus;
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'CHARGE',
          origin: charge.standaloneInstallmentPlanId
            ? 'INSTALLMENT'
            : charge.standaloneSubscriptionId
              ? 'SUBSCRIPTION'
              : 'STANDALONE',
          localStatus: charge.status,
          asaasStatus: effectivePaymentStatus,
          billingType: payment.billingType ?? charge.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(charge.invoiceUrl || payment.invoiceUrl),
          isInstallmentPayment: Boolean(charge.standaloneInstallmentPlanId),
          isSubscriptionPayment: Boolean(charge.standaloneSubscriptionId),
        });

        if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
          return policyBlockedError({
            action: 'CANCEL',
            decision: remotePolicy.actions.CANCEL,
            status: effectivePaymentStatus,
            source: 'ASAAS',
          });
        }

        if (effectivePaymentStatus === 'DELETED') {
          let localStateConverged = false;
            try {
              localStateConverged = await applyImmediateDeletedPaymentConvergence(
                contaId,
                payment,
                charge.externalReference ?? buildStandaloneExternalReference({ chargeId: charge.id }),
              );
              await convergeLocalCanceledPayment({
                contaId,
                chargeId: charge.id,
                asaasPaymentId: charge.asaasPaymentId,
                actorId: user.id,
                reason: 'Cobrança já estava cancelada no Asaas',
              });
              localStateConverged = true;
            } catch (webhookError) {
              console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (standalone)', {
                chargeId: charge.id,
                asaasPaymentId: charge.asaasPaymentId,
              error: webhookError instanceof Error ? webhookError.message : String(webhookError),
            });
          }

          return NextResponse.json(
            cobrancaMutationResultDTOSchema.parse(
              mapCobrancaMutationResultToDTO({
                success: true,
                pending: !localStateConverged,
                message: localStateConverged
                  ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                  : 'Cobrança já estava cancelada no Asaas.',
              }),
            ),
            { status: localStateConverged ? 200 : 202 },
          );
        }
      } catch (readErr) {
        if (readErr instanceof KycNotApprovedError) throw readErr;
        console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou (standalone), seguindo com delete', {
          asaasPaymentId: charge.asaasPaymentId,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
      }

      const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
        contaId,
        type: 'PAYMENT_CANCEL_COMMAND',
        entityType: 'CHARGE',
        entityId: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        actorId: user.id,
        chargeId: charge.id,
        providerStatus: remoteStatusBeforeCommand,
        metadata: {
          source: 'DELETE /api/cobrancas/[id]',
          previousLocalStatus: charge.status,
        },
        run: () => deletePayment(charge.asaasPaymentId!, { contaId }),
      });
      asaasCommandJobId = commandJobId;

      let localStateConverged = false;

        try {
          const webhookResult = await handlePaymentWebhook(
            contaId,
            buildDeletedPaymentWebhookPayload(
              deletedPayment,
            charge.externalReference ?? buildStandaloneExternalReference({ chargeId: charge.id }),
          ),
          );
          localStateConverged = webhookResult.success;
        } catch (webhookError) {
        console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (standalone)', {
          chargeId: charge.id,
          asaasPaymentId: charge.asaasPaymentId,
          error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        });
      }

      if (!localStateConverged) {
        try {
          await syncPaymentStateFromAsaas({
            contaId,
            asaasPaymentId: charge.asaasPaymentId,
            eventName: 'PAYMENT_DELETED',
          });
        } catch (syncError) {
          console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (standalone)', {
            chargeId: charge.id,
            asaasPaymentId: charge.asaasPaymentId,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }

      await convergeLocalCanceledPayment({
        contaId,
        chargeId: charge.id,
        asaasPaymentId: charge.asaasPaymentId,
        actorId: user.id,
        reason: 'Cancelada no Asaas pelo endpoint de cobranças',
      });
      localStateConverged = true;

      await auditLogService.record({
        contaId,
        action: 'finance.charge.cancel_requested',
        entity: { type: 'Charge', id: charge.id },
        metadata: {
          asaasPaymentId: charge.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          statusBefore: charge.status,
          requestedBy: user.id,
        },
      });

      await invalidateChargeResourceCache({
        contaId,
        cobrancaId: charge.id,
        reason: 'charge-delete-standalone',
      });

      return NextResponse.json(
        cobrancaMutationResultDTOSchema.parse(
          mapCobrancaMutationResultToDTO({
            success: true,
            pending: !localStateConverged,
            message: localStateConverged
              ? 'Cobrança cancelada e sincronizada com o Asaas.'
              : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
          }),
        ),
        { status: localStateConverged ? 200 : 202 },
      );
    }

    const contaIdForDelete = cobranca.matricula?.aluno?.contaId;
    if (!isAsaasEnabled() || !cobranca.asaasPaymentId || !contaIdForDelete) {
      return NextResponse.json(
        { success: false, error: 'Cobrança sem integração Asaas' },
        { status: 400 },
      );
    }

    const localPolicy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: resolveAcademicPaymentOrigin(cobranca.tipo),
      localStatus: cobranca.status,
      billingType: cobranca.formaPagamento,
      hasAsaasPaymentId: Boolean(cobranca.asaasPaymentId),
      hasInvoiceUrl: Boolean((cobranca as unknown as { charge?: { invoiceUrl?: string | null } }).charge?.invoiceUrl),
      isInstallmentPayment: cobranca.tipo === 'PARCELADA',
      isSubscriptionPayment: cobranca.tipo === 'RECORRENTE',
    });

    if (!localPolicy.canCancel) {
      return policyBlockedError({
        action: 'CANCEL',
        decision: localPolicy.actions.CANCEL,
        status: cobranca.status,
        source: 'LOCAL',
      });
    }

    let asaasCommandJobId: string | null = null;
    let remoteStatusBeforeCommand: string | null = null;

    // Read-before-write: conferir status atual no Asaas (tolerante a falha)
    try {
      const payment = await readPaymentFullPreflight(cobranca.asaasPaymentId, { contaId: contaIdForDelete });
      const effectivePaymentStatus = getEffectiveRemotePaymentStatus(payment) ?? payment.status;
      remoteStatusBeforeCommand = effectivePaymentStatus;
      const remotePolicy = evaluatePaymentActionPolicy({
        entityType: 'COBRANCA',
        origin: resolveAcademicPaymentOrigin(cobranca.tipo),
        localStatus: cobranca.status,
        asaasStatus: effectivePaymentStatus,
        billingType: payment.billingType ?? cobranca.formaPagamento,
        hasAsaasPaymentId: true,
        hasInvoiceUrl: Boolean(payment.invoiceUrl),
        isInstallmentPayment: cobranca.tipo === 'PARCELADA',
        isSubscriptionPayment: cobranca.tipo === 'RECORRENTE',
      });

      if (!remotePolicy.canCancel && effectivePaymentStatus !== 'DELETED') {
        return policyBlockedError({
          action: 'CANCEL',
          decision: remotePolicy.actions.CANCEL,
          status: effectivePaymentStatus,
          source: 'ASAAS',
        });
      }

      if (effectivePaymentStatus === 'DELETED') {
        let localStateConverged = false;
          try {
            localStateConverged = await applyImmediateDeletedPaymentConvergence(contaIdForDelete, payment);
            await convergeLocalCanceledPayment({
              contaId: contaIdForDelete,
              cobrancaId: cobranca.id,
              asaasPaymentId: cobranca.asaasPaymentId,
              actorId: user.id,
              reason: 'Cobrança já estava cancelada no Asaas',
            });
            localStateConverged = true;
          } catch (webhookError) {
            console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (cobranca)', {
              cobrancaId: cobranca.id,
              asaasPaymentId: cobranca.asaasPaymentId,
            error: webhookError instanceof Error ? webhookError.message : String(webhookError),
          });
        }

        await invalidateChargeResourceCache({
          contaId: contaIdForDelete,
          cobrancaId: cobranca.id,
          reason: 'charge-already-deleted',
        });

        return NextResponse.json(
          cobrancaMutationResultDTOSchema.parse(
            mapCobrancaMutationResultToDTO({
              success: true,
              pending: !localStateConverged,
              message: localStateConverged
                ? 'Cobrança já estava cancelada no Asaas e foi sincronizada localmente.'
                : 'Cobrança já estava cancelada no Asaas.',
            }),
          ),
          { status: localStateConverged ? 200 : 202 },
        );
      }
    } catch (readErr) {
      // Se getPayment falhar (ex: rede), prosseguir com deletePayment
      // O deletePayment falhará com erro claro se o pagamento não puder ser cancelado
      console.warn('[DELETE /api/cobrancas/[id]] Read-before-write falhou, seguindo com delete', {
        asaasPaymentId: cobranca.asaasPaymentId,
        error: readErr instanceof Error ? readErr.message : String(readErr),
      });
    }

    const { result: deletedPayment, commandJobId } = await runAsaasPaymentCommand({
      contaId: contaIdForDelete,
      type: 'PAYMENT_CANCEL_COMMAND',
      entityType: 'COBRANCA',
      entityId: cobranca.id,
      asaasPaymentId: cobranca.asaasPaymentId,
      actorId: user.id,
      cobrancaId: cobranca.id,
      providerStatus: remoteStatusBeforeCommand,
      metadata: {
        source: 'DELETE /api/cobrancas/[id]',
        previousLocalStatus: cobranca.status,
      },
      run: () => deletePayment(cobranca.asaasPaymentId!, { contaId: contaIdForDelete }),
    });
    asaasCommandJobId = commandJobId;

    let localStateConverged = false;

      try {
        const webhookResult = await handlePaymentWebhook(
          contaIdForDelete,
          buildDeletedPaymentWebhookPayload(deletedPayment),
        );
        localStateConverged = webhookResult.success;
      } catch (webhookError) {
      console.warn('[DELETE /api/cobrancas/[id]] Falha ao aplicar convergência imediata (cobranca)', {
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        error: webhookError instanceof Error ? webhookError.message : String(webhookError),
        });
      }

      await convergeLocalCanceledPayment({
        contaId: contaIdForDelete,
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        actorId: user.id,
        reason: 'Cancelada no Asaas pelo endpoint de cobranças',
      });
      localStateConverged = true;

      if (!localStateConverged) {
        await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: { status: 'CANCELAMENTO_PENDENTE' },
      });
    }

    await prisma.logFinanceiro.create({
      data: {
        contaId,
        usuarioId: user.id,
        cobrancaId: cobranca.id,
        acao: 'DELETAR',
        detalhes: {
          asaasPaymentId: cobranca.asaasPaymentId,
          commandJobId: asaasCommandJobId,
          statusBefore: cobranca.status,
          statusAfter: localStateConverged ? 'CANCELADO' : 'CANCELAMENTO_PENDENTE',
          requestedBy: user.id,
        },
      },
    });

    await auditLogService.record({
      contaId,
      action: 'finance.cobranca.cancel_requested',
      entity: { type: 'Cobranca', id: cobranca.id },
      metadata: {
        asaasPaymentId: cobranca.asaasPaymentId,
        commandJobId: asaasCommandJobId,
        statusBefore: cobranca.status,
        requestedBy: user.id,
      },
    });

    if (!localStateConverged) {
      try {
        await syncPaymentStateFromAsaas({
          contaId: contaIdForDelete,
          asaasPaymentId: cobranca.asaasPaymentId,
          eventName: 'PAYMENT_DELETED',
        });
      } catch (syncError) {
        console.warn('[DELETE /api/cobrancas/[id]] Falha ao sincronizar estado (cobranca)', {
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    await invalidateChargeResourceCache({
      contaId: contaIdForDelete,
      cobrancaId: cobranca.id,
      reason: 'charge-delete-academic',
    });

    return NextResponse.json(
      cobrancaMutationResultDTOSchema.parse(
        mapCobrancaMutationResultToDTO({
          success: true,
          pending: !localStateConverged,
          message: localStateConverged
            ? 'Cobrança cancelada e sincronizada com o Asaas.'
            : 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
        }),
      ),
      { status: localStateConverged ? 200 : 202 },
    );
  } catch (error) {
    // KYC não aprovado → 409
    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { success: false, error: 'KYC_NAO_APROVADO' },
        { status: 409 },
      );
    }
    const correlationId = logFinanceApiError('DELETE /api/cobrancas/[id]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao remover cobrança',
        correlationId,
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
