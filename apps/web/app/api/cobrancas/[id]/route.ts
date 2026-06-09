import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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
  syncPaymentStateFromAsaas,
  updatePayment,
  auditLogService,
  evaluatePaymentActionPolicy,
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  markPaymentCommandSent,
  registerPaymentCommand,
  type PaymentActionDecision,
  type PaymentOrigin,
  type PaymentCommandEntityType,
  type PaymentCommandJobType,
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

const ASAAS_EDITABLE_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_PAID_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);
const TERMINAL_CHARGE_STATUSES = new Set(['PAID', 'CANCELED', 'REFUNDED']);
const TERMINAL_ASAAS_PAYMENT_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'DUNNING_RECEIVED',
  'RECEIVED_IN_CASH',
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DELETED',
]);

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

async function runAsaasPaymentCommand<T>(input: {
  contaId: string;
  type: PaymentCommandJobType;
  entityType: PaymentCommandEntityType;
  entityId: string;
  asaasPaymentId: string;
  actorId: string;
  chargeId?: string | null;
  cobrancaId?: string | null;
  providerStatus?: string | null;
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<{ result: T; commandJobId: string }> {
  const command = await registerPaymentCommand({
    contaId: input.contaId,
    type: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    asaasPaymentId: input.asaasPaymentId,
    expectedEvents: expectedEventsForPaymentCommand(input.type),
    correlationId: randomUUID(),
    actorId: input.actorId,
    chargeId: input.chargeId ?? null,
    cobrancaId: input.cobrancaId ?? null,
    metadata: input.metadata,
  });

  try {
    const result = await input.run();
    await markPaymentCommandSent({
      jobId: command.id,
      providerStatus: input.providerStatus ?? null,
    });
    return { result, commandJobId: command.id };
  } catch (error) {
    await failPaymentCommand({ jobId: command.id, error });
    throw error;
  }
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
  const localStatusMap: Record<string, string> = {
    CREATED: 'PENDENTE',
    OPEN: 'PENDENTE',
    PAID: 'PAGO',
    OVERDUE: 'ATRASADO',
    CANCELED: 'CANCELADO',
    REFUNDED: 'ESTORNADO',
  };

  const localStatus = localStatusMap[params.localChargeStatus] ?? 'PENDENTE';
  if (!params.remotePaymentStatus) {
    return localStatus;
  }

  const remoteStatus = mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, {
    dueDate: params.dueDate,
  });

  if (
    TERMINAL_CHARGE_STATUSES.has(params.localChargeStatus) &&
    !TERMINAL_ASAAS_PAYMENT_STATUSES.has(params.remotePaymentStatus)
  ) {
    return localStatus;
  }

  return remoteStatus;
}

function resolveAcademicDisplayedStatus(params: {
  localCobrancaStatus: string;
  remotePaymentStatus?: string | null;
  dueDate: Date;
}) {
  if (!params.remotePaymentStatus) {
    return params.localCobrancaStatus;
  }

  const remoteStatus = mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, {
    dueDate: params.dueDate,
  });

  if (
    TERMINAL_CHARGE_STATUSES.has(params.localCobrancaStatus) &&
    !TERMINAL_ASAAS_PAYMENT_STATUSES.has(params.remotePaymentStatus)
  ) {
    return params.localCobrancaStatus;
  }

  return remoteStatus;
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

function resolveStandaloneChargeTipo(params: {
  standaloneInstallmentPlanId?: string | null;
  externalReference?: string | null;
  familyGroupId?: string | null;
  description?: string | null;
}): 'AVULSA' | 'PARCELADA' | 'RECORRENTE' | 'TAXA_MATRICULA' {
  if (
    params.familyGroupId &&
    params.description?.trim().toLowerCase().startsWith('taxa de matrícula familiar')
  ) {
    return 'TAXA_MATRICULA';
  }

  if (
    params.standaloneInstallmentPlanId ||
    params.externalReference?.startsWith('alusa:installment:') ||
    params.externalReference?.startsWith('installmentPlan:')
  ) {
    return 'PARCELADA';
  }

  if (params.externalReference?.startsWith('alusa:standalone-subscription:')) {
    return 'RECORRENTE';
  }

  return 'AVULSA';
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
      status: payment.status,
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

        const effectiveStatus = resolveStandaloneDisplayedStatus({
          localChargeStatus: charge.status,
          remotePaymentStatus: remoteAsaasData?.status ?? null,
          dueDate: charge.dueDate,
        });

        const effectivePaymentDate =
          remoteAsaasData?.paymentDate ?? remoteAsaasData?.clientPaymentDate ?? null;
        const effectiveLiquidacaoStatus = resolveStandaloneLiquidacaoStatus({
          displayedStatus: effectiveStatus,
          remotePaymentStatus: remoteAsaasData?.status ?? null,
          creditDate: remoteAsaasData?.creditDate ?? null,
          billingType: remoteAsaasData?.billingType ?? charge.billingType ?? null,
        });
        const standaloneDisplayStatus = resolveCobrancaDisplayStatus({
          status: effectiveStatus as StatusCobranca,
          liquidacaoStatus: effectiveLiquidacaoStatus,
          asaasStatus: remoteAsaasData?.status ?? null,
        });
        const effectiveFormaPagamento =
          mapBillingTypeToFormaPagamento(
            (remoteAsaasData?.billingType as string | null | undefined) ?? charge.billingType,
          ) ?? 'INDEFINIDO';
        const standaloneTipo = resolveStandaloneChargeTipo({
          standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
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

        return NextResponse.json(
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
                valorLiquido: toNullableNumber(remoteAsaasData?.netValue),
                taxaAsaas:
                  remoteAsaasData?.netValue != null && remoteAsaasData?.value != null
                    ? Number(remoteAsaasData.value) - Number(remoteAsaasData.netValue)
                    : null,
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
      remotePaymentStatus: remoteAsaasData?.status ?? asaasData?.status ?? null,
      dueDate: effectiveCobranca.vencimento,
    });

    const storedLiquidacao = (effectiveCobranca as unknown as { liquidacaoStatus?: LiquidacaoStatus | null })
      .liquidacaoStatus;
    const effectiveLiquidacaoStatus: LiquidacaoStatus =
      storedLiquidacao ??
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: remoteAsaasData?.status ?? null,
        creditDate: remoteAsaasData?.creditDate ?? null,
        billingType: remoteAsaasData?.billingType ?? null,
      });

    const displayStatus = resolveCobrancaDisplayStatus({
      status: effectiveStatus as StatusCobranca,
      liquidacaoStatus: effectiveLiquidacaoStatus,
      asaasStatus: remoteAsaasData?.status ?? asaasData?.status ?? null,
    });

    const { charge: _academicCharge, ...cobrancaDetail } = effectiveCobranca;

    return NextResponse.json(
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
    console.error('[GET /api/cobrancas/[id]] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao buscar detalhes da cobrança',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
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
    console.error('[PUT /api/cobrancas/[id]] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao atualizar cobrança',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
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
        return NextResponse.json(
          { success: false, error: 'Cobrança não encontrada' },
          { status: 404 },
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
        remoteStatusBeforeCommand = payment.status;
        const remotePolicy = evaluatePaymentActionPolicy({
          entityType: 'CHARGE',
          origin: charge.standaloneInstallmentPlanId
            ? 'INSTALLMENT'
            : charge.standaloneSubscriptionId
              ? 'SUBSCRIPTION'
              : 'STANDALONE',
          localStatus: charge.status,
          asaasStatus: payment.status,
          billingType: payment.billingType ?? charge.billingType,
          hasAsaasPaymentId: true,
          hasInvoiceUrl: Boolean(charge.invoiceUrl || payment.invoiceUrl),
          isInstallmentPayment: Boolean(charge.standaloneInstallmentPlanId),
          isSubscriptionPayment: Boolean(charge.standaloneSubscriptionId),
        });

        if (!remotePolicy.canCancel) {
          return policyBlockedError({
            action: 'CANCEL',
            decision: remotePolicy.actions.CANCEL,
            status: payment.status,
            source: 'ASAAS',
          });
        }

        if (payment.deleted || payment.status === 'DELETED') {
          let localStateConverged = false;
          try {
            localStateConverged = await applyImmediateDeletedPaymentConvergence(
              contaId,
              payment,
              charge.externalReference ?? buildStandaloneExternalReference({ chargeId: charge.id }),
            );
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
      remoteStatusBeforeCommand = payment.status;
      const remotePolicy = evaluatePaymentActionPolicy({
        entityType: 'COBRANCA',
        origin: resolveAcademicPaymentOrigin(cobranca.tipo),
        localStatus: cobranca.status,
        asaasStatus: payment.status,
        billingType: payment.billingType ?? cobranca.formaPagamento,
        hasAsaasPaymentId: true,
        hasInvoiceUrl: Boolean(payment.invoiceUrl),
        isInstallmentPayment: cobranca.tipo === 'PARCELADA',
        isSubscriptionPayment: cobranca.tipo === 'RECORRENTE',
      });

      if (!remotePolicy.canCancel) {
        return policyBlockedError({
          action: 'CANCEL',
          decision: remotePolicy.actions.CANCEL,
          status: payment.status,
          source: 'ASAAS',
        });
      }

      if (payment.deleted || payment.status === 'DELETED') {
        let localStateConverged = false;
        try {
          localStateConverged = await applyImmediateDeletedPaymentConvergence(contaIdForDelete, payment);
        } catch (webhookError) {
          console.warn('[DELETE /api/cobrancas/[id]] Falha ao reconciliar cobrança já deletada (cobranca)', {
            cobrancaId: cobranca.id,
            asaasPaymentId: cobranca.asaasPaymentId,
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
    console.error('[DELETE /api/cobrancas/[id]] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro ao remover cobrança',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
