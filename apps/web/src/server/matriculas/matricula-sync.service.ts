import type { PrismaClient } from '@prisma/client';
import { Prisma, StatusCobranca, StatusMatricula } from '@prisma/client';
import {
  ativarAssinatura,
  deletePayment,
  deleteSubscription,
  getPayment,
  getSubscription,
  pauseAssinatura,
  commitBillingAgreementChange,
  previewBillingAgreementChange,
  materializeBillingAgreement,
  BillingAgreementError,
} from '@alusa/finance';
import { AsaasHttpError } from '@alusa/finance';
import { resolvePayer } from '@alusa/domain';
import {
  assertStudentCapacity,
  countAdditionalActiveStudentsForEnrollment,
} from '@/src/server/platform-billing/capacity';
import {
  syncFamilyLifecycleAggregate,
  type FamilyLifecycleImpact,
} from './family-lifecycle.service';

export class ManualSyncError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ManualSyncError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export type SyncMatriculaStatusInput = {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  targetStatus: 'ATIVA' | 'PAUSADA' | 'CANCELADA';
  actorId: string;
  motivo?: string;
};

export type SyncMatriculaStatusResult = {
  matriculaId: string;
  previousStatus: StatusMatricula;
  newStatus: StatusMatricula;
  asaasAction: 'SUSPEND' | 'ACTIVATE' | 'DELETE' | 'LOCAL_ONLY';
  cobrancasAtualizadas: number;
  paymentSync: {
    totalFromAsaas: number;
    matched: number;
    updated: number;
    warnings: string[];
    details: unknown[];
    expectedWebhooks: string[];
  };
  asaasResponse?: unknown;
  nextDueDate?: string | null;
  familyImpact?: FamilyLifecycleImpact | null;
};

const DEFAULT_CANCELLATION_REASON = 'Cancelamento manual da matrícula';

type MatriculaFinancialIdentity = {
  payerType: 'ALUNO' | 'RESPONSAVEL';
  payerId: string;
  customerId: string | null;
};

/**
 * Resolve a matrícula's financial identity from the same domain rule used by
 * enrollment and renewal flows. This is intentionally read-only and optional
 * during rollout so legacy test fixtures/records without the canonical link
 * can still be reconciled without inventing a customer.
 */
async function resolveMatriculaFinancialIdentity(
  prisma: PrismaClient,
  contaId: string,
  matriculaId: string,
): Promise<MatriculaFinancialIdentity | null> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, contaId },
    select: {
      aluno: { select: { id: true, dataNasc: true, asaasCustomerId: true } },
      responsavelFinanceiroId: true,
      responsavelFinanceiro: { select: { id: true, asaasCustomerId: true } },
    },
  });

  if (!matricula?.aluno) return null;
  const resolved = resolvePayer({
    alunoId: matricula.aluno.id,
    alunoDataNasc: matricula.aluno.dataNasc,
    responsavelFinanceiroId: matricula.responsavelFinanceiroId,
  });
  if (!resolved.success) return null;

  const payerType = resolved.payer.type;
  const payerId = resolved.payer.id;
  const directCustomerId = payerType === 'ALUNO'
    ? matricula.aluno.asaasCustomerId
    : matricula.responsavelFinanceiro?.asaasCustomerId ?? null;

  const customerDelegate = (prisma as PrismaClient & {
    customer?: {
      findFirst: (_args: unknown) => Promise<{ asaasCustomerId: string | null } | null>;
    };
  }).customer;
  const customer = customerDelegate
    ? await customerDelegate.findFirst({
        where: {
          contaId,
          OR: [
            { payerType, payerId },
            { payerLinks: { some: { contaId, payerType, payerId } } },
          ],
        },
        select: { asaasCustomerId: true },
      })
    : null;

  return { payerType, payerId, customerId: customer?.asaasCustomerId ?? directCustomerId ?? null };
}

const OPEN_CHARGE_STATUSES = new Set<StatusCobranca>([
  StatusCobranca.PENDENTE,
  StatusCobranca.A_VENCER,
  StatusCobranca.ATRASADO,
  StatusCobranca.CANCELAMENTO_PENDENTE,
]);

const ASAAS_DELETABLE_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_PAID_PAYMENT_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

function getChargeWarningPrefix(cobrancaId: string) {
  return `Cobrança ${cobrancaId}:`;
}

async function markChargeAsCanceled(params: {
  prisma: PrismaClient;
  contaId: string;
  cobrancaId: string;
  actorId: string;
  motivo?: string;
}) {
  await params.prisma.cobranca.update({
    where: { id: params.cobrancaId },
    data: {
      status: StatusCobranca.CANCELADO,
      canceladoEm: new Date(),
      canceladoMotivo: params.motivo ?? 'Cancelada junto com o encerramento da matrícula',
      canceladoPor: params.actorId,
    },
  });
  await params.prisma.charge.updateMany({
    where: {
      contaId: params.contaId,
      cobrancaId: params.cobrancaId,
    },
    data: {
      status: 'CANCELED',
      statusUpdatedAt: new Date(),
    },
  });
}

async function syncOpenChargesForCancellation(params: {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  motivo?: string;
}) {
  const cobrancas = await params.prisma.cobranca.findMany({
    where: {
      matriculaId: params.matriculaId,
      status: { in: Array.from(OPEN_CHARGE_STATUSES) },
    },
    select: {
      id: true,
      status: true,
      asaasPaymentId: true,
    },
    orderBy: { vencimento: 'asc' },
  });

  const warnings: string[] = [];
  const details: SyncMatriculaStatusResult['paymentSync']['details'] = [];
  let updated = 0;
  let matched = 0;
  let totalFromAsaas = 0;

  for (const cobranca of cobrancas) {
    const warningPrefix = getChargeWarningPrefix(cobranca.id);

    if (!cobranca.asaasPaymentId) {
      await markChargeAsCanceled({
        prisma: params.prisma,
        contaId: params.contaId,
        cobrancaId: cobranca.id,
        actorId: params.actorId,
        motivo: params.motivo,
      });
      updated += 1;
      details.push({
        cobrancaId: cobranca.id,
        asaasPaymentId: null,
        novoStatus: StatusCobranca.CANCELADO,
        source: 'LOCAL',
      });
      continue;
    }

    totalFromAsaas += 1;

    try {
      const payment = await getPayment(cobranca.asaasPaymentId, { contaId: params.contaId });
      matched += 1;

      if (payment.deleted || payment.status === 'DELETED') {
        await markChargeAsCanceled({
          prisma: params.prisma,
          contaId: params.contaId,
          cobrancaId: cobranca.id,
          actorId: params.actorId,
          motivo: params.motivo,
        });
        updated += 1;
        details.push({
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          novoStatus: StatusCobranca.CANCELADO,
          source: 'ASAAS',
        });
        continue;
      }

      if (ASAAS_PAID_PAYMENT_STATUSES.has(payment.status)) {
        warnings.push(
          `${warningPrefix} já está paga no Asaas (${payment.status}) e foi mantida para preservar o histórico financeiro.`,
        );
        continue;
      }

      if (!ASAAS_DELETABLE_PAYMENT_STATUSES.has(payment.status)) {
        warnings.push(
          `${warningPrefix} está em estado ${payment.status} no Asaas e precisa de conferência manual antes de qualquer remoção.`,
        );
        continue;
      }

      await deletePayment(cobranca.asaasPaymentId, { contaId: params.contaId });
      await markChargeAsCanceled({
        prisma: params.prisma,
        contaId: params.contaId,
        cobrancaId: cobranca.id,
        actorId: params.actorId,
        motivo: params.motivo,
      });
      updated += 1;
      details.push({
        cobrancaId: cobranca.id,
        asaasPaymentId: cobranca.asaasPaymentId,
        novoStatus: StatusCobranca.CANCELADO,
        source: 'ASAAS',
      });
    } catch (error) {
      if (error instanceof AsaasHttpError && error.status === 404) {
        warnings.push(
          `${warningPrefix} não foi encontrada no Asaas. O histórico local foi preservado e a cobrança foi marcada como cancelada.`,
        );
        await markChargeAsCanceled({
          prisma: params.prisma,
          contaId: params.contaId,
          cobrancaId: cobranca.id,
          actorId: params.actorId,
          motivo: params.motivo,
        });
        updated += 1;
        details.push({
          cobrancaId: cobranca.id,
          asaasPaymentId: cobranca.asaasPaymentId,
          novoStatus: StatusCobranca.CANCELADO,
          source: 'ASAAS',
        });
        continue;
      }

      warnings.push(
        `${warningPrefix} não pôde ser ajustada automaticamente: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Reconcilia cobranças acadêmicas que já estavam canceladas antes desta
  // operação. Isso cobre a corrida em que o webhook exclui o pagamento ou a
  // cobrança local é cancelada antes de o Charge read-model ser projetado.
  // Nunca toca em cobranças liquidadas/estornadas: o histórico financeiro é
  // imutável.
  const alreadyCanceled = await params.prisma.cobranca.findMany({
    where: {
      contaId: params.contaId,
      matriculaId: params.matriculaId,
      status: StatusCobranca.CANCELADO,
    },
    select: { id: true },
  });
  if (alreadyCanceled.length > 0) {
    const repaired = await params.prisma.charge.updateMany({
      where: {
        contaId: params.contaId,
        cobrancaId: { in: alreadyCanceled.map((item) => item.id) },
        status: { in: ['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE'] },
      },
      data: { status: 'CANCELED', statusUpdatedAt: new Date() },
    });
    if (repaired.count > 0) {
      updated += repaired.count;
      details.push({
        cobrancasReconciliadas: repaired.count,
        source: 'LOCAL_RECONCILIATION',
      });
    }
  }

  return {
    totalFromAsaas,
    matched,
    updated,
    warnings,
    details,
    expectedWebhooks: totalFromAsaas > 0 ? ['PAYMENT_DELETED'] : [],
  };
}

function extractFinancialErrorMessage(error: AsaasHttpError): string | null {
  const responseBody = error.responseBody;

  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  const message = 'message' in responseBody && typeof responseBody.message === 'string'
    ? responseBody.message
    : null;

  if (message) {
    return message;
  }

  const errors = 'errors' in responseBody && Array.isArray(responseBody.errors)
    ? responseBody.errors
    : [];

  const descriptions = errors
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const description = 'description' in item && typeof item.description === 'string'
        ? item.description
        : 'message' in item && typeof item.message === 'string'
          ? item.message
          : null;
      return description;
    })
    .filter((value): value is string => Boolean(value));

  return descriptions.length > 0 ? descriptions.join(', ') : null;
}

function buildFinancialSyncError(
  targetStatus: SyncMatriculaStatusInput['targetStatus'],
  subscriptionId: string,
  error: unknown,
): ManualSyncError {
  const actionLabel = targetStatus === 'PAUSADA'
    ? 'pausar'
    : targetStatus === 'ATIVA'
      ? 'reativar'
      : 'cancelar';

  const rawErrorMessage = error instanceof Error ? error.message : String(error);
  if (targetStatus === 'CANCELADA' && rawErrorMessage.includes('Allocation validity must be a non-empty semiopen interval')) {
    return new ManualSyncError(
      409,
      'INCONSISTENCIA_FINANCEIRA',
      'Não foi possível encerrar a matrícula porque existe uma inconsistência financeira. Nenhuma alteração foi realizada.',
      { subscriptionId },
    );
  }

  if (error instanceof BillingAgreementError) {
    if (error.code === 'PAYER_IDENTITY_CONFLICT') {
      return new ManualSyncError(
        409,
        'FINANCE_IDENTITY_CONFLICT',
        `Não foi possível ${actionLabel} a matrícula porque o pagador da matrícula não corresponde à assinatura financeira. Corrija o vínculo financeiro e tente novamente.`,
        { subscriptionId, ...error.details },
      );
    }

    if (error.code === 'REMOTE_STATE_DIVERGED' && /customer|pagador/i.test(error.message)) {
      return new ManualSyncError(
        409,
        'FINANCE_IDENTITY_CONFLICT',
        `Não foi possível ${actionLabel} a matrícula porque o customer da assinatura não corresponde ao pagador esperado.`,
        { subscriptionId, ...error.details },
      );
    }

    if (error.code === 'INVALID_INPUT' && /justificativa|motivo/i.test(error.message)) {
      return new ManualSyncError(
        422,
        'FINANCEIRO_REQUER_JUSTIFICATIVA',
        `Não foi possível ${actionLabel} a matrícula porque é necessário informar uma justificativa financeira válida.`,
        { subscriptionId },
      );
    }

    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return new ManualSyncError(
        409,
        'IDEMPOTENCY_CONFLICT',
        `Não foi possível ${actionLabel} a matrícula porque já existe uma tentativa com dados diferentes. Gere uma nova tentativa.`,
        { subscriptionId, ...error.details },
      );
    }

    if (error.code === 'PREVIEW_EXPIRED' || error.code === 'PREVIEW_MISMATCH' || error.code === 'AGREEMENT_VERSION_CONFLICT') {
      return new ManualSyncError(
        409,
        'FINANCEIRO_REQUER_NOVO_PREVIEW',
        `Não foi possível ${actionLabel} a matrícula porque o cenário financeiro mudou. Tente novamente.`,
        { subscriptionId, ...error.details },
      );
    }
  }

  if (error instanceof AsaasHttpError) {
    const providerMessage = extractFinancialErrorMessage(error);

    if (error.status === 404) {
      return new ManualSyncError(
        409,
        'ASSINATURA_FINANCEIRA_NAO_ENCONTRADA',
        `Não foi possível ${actionLabel} a matrícula porque a assinatura financeira vinculada não foi encontrada ou não pertence à conta desta instituição.`,
        {
          status: error.status,
          subscriptionId,
          providerMessage,
        },
      );
    }

    if (error.status === 401 || error.status === 403) {
      return new ManualSyncError(
        502,
        'FINANCEIRO_AUTENTICACAO_INVALIDA',
        `Não foi possível ${actionLabel} a matrícula porque a conta financeira da instituição não autorizou a operação.`,
        {
          status: error.status,
          subscriptionId,
          providerMessage,
        },
      );
    }

    if (error.status === 400 || error.status === 422) {
      return new ManualSyncError(
        422,
        'FINANCEIRO_REJEITOU_OPERACAO',
        providerMessage
          ? `Não foi possível ${actionLabel} a matrícula: ${providerMessage}`
          : `Não foi possível ${actionLabel} a matrícula porque a operação foi rejeitada pelo serviço financeiro.`,
        {
          status: error.status,
          subscriptionId,
          providerMessage,
        },
      );
    }

    return new ManualSyncError(
      502,
      'ASAAS_ERROR',
      providerMessage
        ? `Não foi possível ${actionLabel} a matrícula no financeiro: ${providerMessage}`
        : `Não foi possível ${actionLabel} a matrícula porque o serviço financeiro falhou ao atualizar a assinatura vinculada.`,
      {
        status: error.status,
        subscriptionId,
        providerMessage,
      },
    );
  }

  return new ManualSyncError(
    502,
    'ASAAS_ERROR',
    `Não foi possível ${actionLabel} a matrícula porque o serviço financeiro falhou ao atualizar a assinatura vinculada.`,
    {
      subscriptionId,
      providerMessage: error instanceof Error ? error.message : String(error),
    },
  );
}

const NON_RETRYABLE_CANCELLATION_CODES = new Set([
  'FINANCE_IDENTITY_CONFLICT',
  'FINANCEIRO_REQUER_JUSTIFICATIVA',
  'FINANCEIRO_REQUER_NOVO_PREVIEW',
  'IDEMPOTENCY_CONFLICT',
  'INCONSISTENCIA_FINANCEIRA',
  'MATRICULA_NOT_FOUND',
]);

function isRetryableCancellationFailure(mapped: ManualSyncError, original: unknown): boolean {
  if (NON_RETRYABLE_CANCELLATION_CODES.has(mapped.code)) return false;
  if (original instanceof BillingAgreementError) {
    return original.code === 'REMOTE_OPERATION_UNCERTAIN' || original.code === 'OPERATION_BUSY';
  }
  if (original instanceof AsaasHttpError) return original.status === 429 || original.status >= 500;
  return true;
}

function failureMetadata(mapped: ManualSyncError, original: unknown): Prisma.InputJsonValue {
  return {
    retryable: isRetryableCancellationFailure(mapped, original),
    reasonCode: mapped.code,
  } as Prisma.InputJsonValue;
}

function failureOperationStatus(mapped: ManualSyncError, original: unknown): 'DIVERGENTE' | 'MANUAL_REVIEW' {
  return isRetryableCancellationFailure(mapped, original) ? 'DIVERGENTE' : 'MANUAL_REVIEW';
}

async function getOrCreateCancellationOperation(input: {
  prisma: PrismaClient;
  contaId: string;
  matriculaId: string;
  actorId: string;
  motivo?: string;
}) {
  const motivo = input.motivo?.trim() || DEFAULT_CANCELLATION_REASON;
  const where: Prisma.MatriculaOperacaoWhereInput = {
    contaId: input.contaId,
    matriculaId: input.matriculaId,
    tipo: 'CANCELAMENTO' as const,
    status: { in: ['PENDENTE_SINCRONISMO', 'DIVERGENTE', 'ERRO', 'MANUAL_REVIEW'] },
  };
  const select = { id: true, correlationId: true } as const;
  const existing = await input.prisma.matriculaOperacao.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select,
  });
  if (existing) return existing;

  try {
    return await input.prisma.matriculaOperacao.create({
      data: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        tipo: 'CANCELAMENTO',
        origem: 'USER',
        status: 'PENDENTE_SINCRONISMO',
        actorId: input.actorId,
        observacao: motivo,
        payloadEnviado: {
          targetStatus: 'CANCELADA',
          motivo,
        } as Prisma.InputJsonValue,
      },
      select,
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const concurrent = await input.prisma.matriculaOperacao.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!concurrent) throw error;
    return concurrent;
  }
}

export async function syncMatriculaStatus(input: SyncMatriculaStatusInput): Promise<SyncMatriculaStatusResult> {
  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: { id: true, status: true, asaasSubscriptionId: true, matriculaFamiliarId: true },
  });

  if (!matricula) {
    throw new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada.');
  }

  const previousStatus = matricula.status;
  const newStatus = input.targetStatus as StatusMatricula;
  const wasAlreadyCanceled = matricula.status === StatusMatricula.CANCELADA;
  const effectiveMotivo = input.motivo?.trim() || (
    input.targetStatus === 'CANCELADA'
      ? DEFAULT_CANCELLATION_REASON
      : input.targetStatus === 'PAUSADA'
        ? 'Pausa manual da matrícula'
        : 'Ativação manual da matrícula'
  );

  let cancellationOperation: { id: string; correlationId: string } | null = null;
  if (input.targetStatus === 'CANCELADA') {
    if (matricula.status === StatusMatricula.CANCELADA) {
      cancellationOperation = await input.prisma.matriculaOperacao.findFirst({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          tipo: 'CANCELAMENTO',
          status: { in: ['PENDENTE_SINCRONISMO', 'DIVERGENTE', 'ERRO'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, correlationId: true },
      });
      // Mesmo já cancelada, a matrícula pode ter um Charge read-model
      // divergente. Prosseguimos para reconciliar cobranças locais sem
      // repetir a operação remota nem criar uma nova operação de auditoria.
    } else {
      cancellationOperation = await getOrCreateCancellationOperation({
        prisma: input.prisma,
        contaId: input.contaId,
        matriculaId: matricula.id,
        actorId: input.actorId,
        motivo: effectiveMotivo,
      });
    }
  }

  let asaasAction: SyncMatriculaStatusResult['asaasAction'] = 'LOCAL_ONLY';
  let expectedWebhooks: string[] = [];
  let asaasResponse: unknown = undefined;
  let paymentSync: SyncMatriculaStatusResult['paymentSync'] = {
    totalFromAsaas: 0,
    matched: 0,
    updated: 0,
    warnings: [],
    details: [],
    expectedWebhooks: [],
  };
  let canonicalAllocation = await input.prisma.billingAllocation.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: matricula.id,
      kind: 'TUITION',
      status: input.targetStatus === 'ATIVA' ? 'PAUSED' : { in: ['ACTIVE', 'SCHEDULED'] },
    },
    orderBy: input.targetStatus === 'ATIVA' ? { validUntil: 'desc' } : { validFrom: 'desc' },
    select: {
      id: true,
      agreementId: true,
      agreement: {
        select: {
          version: true,
          nextDueDate: true,
          payerType: true,
          payerId: true,
          customerId: true,
        },
      },
    },
  });
  // Garante paridade para grupos familiares criados antes da camada canônica:
  // cancelar uma matrícula deve remover sua alocação da assinatura compartilhada.
  if (!canonicalAllocation && matricula.matriculaFamiliarId) {
    const familySubscription = await input.prisma.standaloneSubscription.findFirst({
      where: { contaId: input.contaId, familyGroupId: matricula.matriculaFamiliarId },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (familySubscription) {
      await materializeBillingAgreement({
        kind: 'FAMILY',
        contaId: input.contaId,
        standaloneSubscriptionId: familySubscription.id,
        familyGroupId: matricula.matriculaFamiliarId,
        actorId: input.actorId,
      });
      canonicalAllocation = await input.prisma.billingAllocation.findFirst({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          kind: 'TUITION',
          status: input.targetStatus === 'ATIVA' ? 'PAUSED' : { in: ['ACTIVE', 'SCHEDULED'] },
        },
        orderBy: input.targetStatus === 'ATIVA' ? { validUntil: 'desc' } : { validFrom: 'desc' },
        select: {
          id: true,
          agreementId: true,
          agreement: {
            select: {
              version: true,
              nextDueDate: true,
              payerType: true,
              payerId: true,
              customerId: true,
            },
          },
        },
      });
    }
  }
  let canonicalHandled = false;

  if (canonicalAllocation) {
    const identity = await resolveMatriculaFinancialIdentity(
      input.prisma,
      input.contaId,
      matricula.id,
    );
    const agreement = canonicalAllocation.agreement;
    if (
      identity &&
      agreement.payerType &&
      agreement.payerId &&
      (agreement.payerType !== identity.payerType || agreement.payerId !== identity.payerId ||
        (agreement.customerId && identity.customerId && agreement.customerId !== identity.customerId))
    ) {
      const identityError = buildFinancialSyncError(
        input.targetStatus,
        matricula.asaasSubscriptionId ?? canonicalAllocation.agreementId,
        new BillingAgreementError('PAYER_IDENTITY_CONFLICT', 'O acordo financeiro não corresponde ao pagador canônico da matrícula.', {
          agreementPayerType: agreement.payerType,
          agreementPayerId: agreement.payerId,
          agreementCustomerId: agreement.customerId,
          expectedPayerType: identity.payerType,
          expectedPayerId: identity.payerId,
          expectedCustomerId: identity.customerId,
        }),
      );
      if (cancellationOperation) {
        await input.prisma.matriculaOperacao.update({
          where: { id: cancellationOperation.id },
          data: {
            status: 'MANUAL_REVIEW',
            erro: identityError.message,
            metadata: { retryable: false, reasonCode: identityError.code },
            processedAt: new Date(),
          },
        });
      }
      throw identityError;
    }
    const effectiveDate = new Date().toISOString().slice(0, 10);
    const change = input.targetStatus === 'ATIVA'
      ? {
          kind: 'RESUME_ALLOCATION' as const,
          contaId: input.contaId,
          agreementId: canonicalAllocation.agreementId,
          actorId: input.actorId,
          reason: effectiveMotivo,
          effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
          effectiveDate,
          allocationIds: [canonicalAllocation.id],
          nextDueDate: canonicalAllocation.agreement.nextDueDate?.toISOString().slice(0, 10) ?? effectiveDate,
        }
      : {
          kind: input.targetStatus === 'PAUSADA' ? 'PAUSE_ALLOCATION' as const : 'REMOVE_ALLOCATION' as const,
          contaId: input.contaId,
          agreementId: canonicalAllocation.agreementId,
          actorId: input.actorId,
          reason: effectiveMotivo,
          effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
          effectiveDate,
          allocationIds: [canonicalAllocation.id],
        };
    try {
      const preview = await previewBillingAgreementChange(change);
      const result = await commitBillingAgreementChange({
        ...change,
        // O preview faz parte da identidade da tentativa. Se o acordo mudar
        // entre tentativas, uma nova operação deve ser criada; reenvios do
        // mesmo preview continuam idempotentes.
        uiRequestId: `status:${matricula.id}:${input.targetStatus}:${effectiveDate}:${preview.previewHash.slice(0, 20)}`,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedAgreementVersion: canonicalAllocation.agreement.version,
      });
      canonicalHandled = true;
      asaasAction = input.targetStatus === 'PAUSADA' ? 'SUSPEND' : input.targetStatus === 'ATIVA' ? 'ACTIVATE' : 'DELETE';
      expectedWebhooks = result.status === 'COMPLETED' ? [] : ['RECONCILIATION_REQUIRED'];
      asaasResponse = { operationId: result.operationId, status: result.status };
    } catch (error) {
      const mappedError = buildFinancialSyncError(
        input.targetStatus,
        matricula.asaasSubscriptionId ?? canonicalAllocation.agreementId,
        error,
      );
      if (input.targetStatus === 'CANCELADA' && cancellationOperation) {
        await input.prisma.matriculaOperacao.update({
          where: { id: cancellationOperation.id },
          data: {
            status: failureOperationStatus(mappedError, error),
            erro: error instanceof Error ? error.message : String(error),
            metadata: failureMetadata(mappedError, error),
            processedAt: new Date(),
          },
        }).catch((operationError) => {
          console.error('[MATRICULA_CANCELAMENTO] Falha ao registrar divergência da operação', {
            operationId: cancellationOperation.id,
            error: operationError instanceof Error ? operationError.message : String(operationError),
          });
        });
      }
      throw mappedError;
    }
  }

  if (!canonicalHandled && matricula.asaasSubscriptionId && !wasAlreadyCanceled) {
    try {
      if (input.targetStatus === 'PAUSADA') {
        asaasAction = 'SUSPEND';
        expectedWebhooks = ['SUBSCRIPTION_INACTIVATED'];
        asaasResponse = await pauseAssinatura({
          subscriptionId: matricula.asaasSubscriptionId,
          contaId: input.contaId,
        });
      } else if (input.targetStatus === 'ATIVA') {
        asaasAction = 'ACTIVATE';
        expectedWebhooks = ['SUBSCRIPTION_UPDATED'];
        const sub = await getSubscription(matricula.asaasSubscriptionId, { contaId: input.contaId });
        const nextDueDate = sub.nextDueDate ?? new Date().toISOString().slice(0, 10);
        asaasResponse = await ativarAssinatura({
          subscriptionId: matricula.asaasSubscriptionId,
          contaId: input.contaId,
          nextDueDate,
        });
      } else if (input.targetStatus === 'CANCELADA') {
        asaasAction = 'DELETE';
        expectedWebhooks = ['SUBSCRIPTION_DELETED'];
        try {
          const identity = await resolveMatriculaFinancialIdentity(
            input.prisma,
            input.contaId,
            matricula.id,
          );
          if (identity?.customerId) {
            const remoteSubscription = await getSubscription(matricula.asaasSubscriptionId, {
              contaId: input.contaId,
            });
            if (remoteSubscription.customer && identity.customerId !== remoteSubscription.customer) {
              throw new BillingAgreementError(
                'PAYER_IDENTITY_CONFLICT',
                'A assinatura legada não corresponde ao pagador canônico da matrícula.',
                {
                  expectedCustomerId: identity.customerId,
                  remoteCustomerId: remoteSubscription.customer,
                },
              );
            }
          }
          asaasResponse = await deleteSubscription(matricula.asaasSubscriptionId, { contaId: input.contaId });
        } catch (error) {
          if (error instanceof AsaasHttpError && error.status === 404) {
            asaasResponse = { deleted: true, alreadyAbsent: true };
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      const mappedError = buildFinancialSyncError(input.targetStatus, matricula.asaasSubscriptionId, error);
      if (input.targetStatus === 'CANCELADA' && cancellationOperation) {
        await input.prisma.matriculaOperacao.update({
          where: { id: cancellationOperation.id },
          data: {
            status: failureOperationStatus(mappedError, error),
            erro: error instanceof Error ? error.message : String(error),
            metadata: failureMetadata(mappedError, error),
            processedAt: new Date(),
          },
        }).catch((operationError) => {
          console.error('[MATRICULA_CANCELAMENTO] Falha ao registrar divergência da operação', {
            operationId: cancellationOperation.id,
            error: operationError instanceof Error ? operationError.message : String(operationError),
          });
        });
      }
      throw mappedError;
    }
  }

  if (input.targetStatus === 'CANCELADA') {
    paymentSync = await syncOpenChargesForCancellation({
      prisma: input.prisma,
      matriculaId: matricula.id,
      contaId: input.contaId,
      actorId: input.actorId,
      motivo: effectiveMotivo,
    });
  }

  await input.prisma.$transaction(async (tx) => {
    // Re-validate inside transaction for atomicity
    const verify = await tx.matricula.findFirst({
      where: { id: matricula.id, aluno: { contaId: input.contaId } },
      select: { id: true, alunoId: true, status: true },
    });
    if (!verify) throw new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada durante a sincronização.');

    if (newStatus === StatusMatricula.ATIVA && verify.status !== StatusMatricula.ATIVA) {
      const additionalActiveStudents = await countAdditionalActiveStudentsForEnrollment({
        tx,
        contaId: input.contaId,
        alunoId: verify.alunoId,
      });
      await assertStudentCapacity({
        tx,
        contaId: input.contaId,
        additionalActiveStudents,
        operation: 'matricula.status.activate',
      });
    }

    const cancellationHasWarnings =
      input.targetStatus === 'CANCELADA' && paymentSync.warnings.length > 0;

    await tx.matricula.update({
      where: { uq_matricula_conta_id: { contaId: input.contaId, id: matricula.id } },
      data: input.targetStatus === 'CANCELADA'
        ? {
            status: newStatus,
            statusFinanceiro: 'SUSPENSO',
            statusContrato: 'CANCELADO',
            billingProvisionStatus: 'CANCELADO',
            integrationStatus: cancellationHasWarnings ? 'DIVERGENTE' : 'SINCRONIZADO',
            warningCode: cancellationHasWarnings
              ? 'CANCELAMENTO_FINANCEIRO_REQUER_RECONCILIACAO'
              : null,
          }
        : { status: newStatus },
    });

    if (input.targetStatus === 'CANCELADA') {
      await tx.contrato.updateMany({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          status: { not: 'CANCELADO' },
        },
        data: { status: 'CANCELADO' },
      });
      await tx.subscription.updateMany({
        where: { contaId: input.contaId, matriculaId: matricula.id },
        data: { status: 'DELETED', statusUpdatedAt: new Date() },
      });

      if (cancellationOperation) {
        await tx.matriculaOperacao.update({
          where: { id: cancellationOperation.id },
          data: {
            status: cancellationHasWarnings ? 'DIVERGENTE' : 'SINCRONIZADO',
            erro: cancellationHasWarnings ? paymentSync.warnings.join(' | ') : null,
            payloadRecebido: {
              correlationId: cancellationOperation.correlationId,
              asaasAction,
              asaasResponse: asaasResponse ?? null,
              paymentSync,
            } as Prisma.InputJsonValue,
            processedAt: new Date(),
          },
        });
      }
    }

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_STATUS_SYNC',
        metadata: {
          previousStatus,
          newStatus,
          motivo: effectiveMotivo,
          asaasAction,
          cobrancasAtualizadas: paymentSync.updated,
          paymentWarnings: paymentSync.warnings,
          cancellationOperationId: cancellationOperation?.id ?? null,
        },
      },
    });
  });

  const familyImpact = matricula.matriculaFamiliarId
    ? await syncFamilyLifecycleAggregate({
        prisma: input.prisma,
        contaId: input.contaId,
        familyId: matricula.matriculaFamiliarId,
      })
    : null;

  return {
    matriculaId: matricula.id,
    previousStatus,
    newStatus,
    asaasAction,
    cobrancasAtualizadas: paymentSync.updated,
    paymentSync: {
      ...paymentSync,
      expectedWebhooks: [...new Set([...expectedWebhooks, ...paymentSync.expectedWebhooks])],
    },
    asaasResponse,
    nextDueDate: null,
    familyImpact,
  };
}

export async function reconcilePendingMatriculaCancellations(input: {
  prisma: PrismaClient;
  contaId: string;
  limit?: number;
}) {
  const operations = await input.prisma.matriculaOperacao.findMany({
    where: {
      contaId: input.contaId,
      tipo: 'CANCELAMENTO',
      status: { in: ['PENDENTE_SINCRONISMO', 'DIVERGENTE', 'ERRO'] },
    },
    select: {
      id: true,
      matriculaId: true,
      actorId: true,
      observacao: true,
      metadata: true,
      erro: true,
      matricula: { select: { status: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(input.limit ?? 50, 200)),
  });

  const reconciled: string[] = [];
  const errors: Array<{ operationId: string; error: string }> = [];

  for (const operation of operations) {
    const metadata = operation.metadata && typeof operation.metadata === 'object' && !Array.isArray(operation.metadata)
      ? operation.metadata as Record<string, unknown>
      : null;
    const retryable = metadata?.retryable;
    const deterministicError = typeof operation.erro === 'string' && /customer remoto|pagador|justificativa|idempot[eê]ncia|preview financeiro/i.test(operation.erro);
    if (retryable === false || deterministicError) {
      await input.prisma.matriculaOperacao.update({
        where: { id: operation.id },
        data: {
          status: 'MANUAL_REVIEW',
          metadata: {
            ...(metadata ?? {}),
            retryable: false,
            reasonCode: metadata?.reasonCode ?? 'MANUAL_REVIEW_REQUIRED',
          } as Prisma.InputJsonValue,
        },
      }).catch((updateError) => {
        console.error('[MATRICULA_CANCELAMENTO] Falha ao marcar operação para revisão manual', {
          operationId: operation.id,
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
      });
      errors.push({
        operationId: operation.id,
        error: 'Operação requer revisão manual e não será repetida automaticamente.',
      });
      continue;
    }
    try {
      if (!operation.actorId) {
        throw new Error('Operação de cancelamento sem actorId não pode ser reconciliada automaticamente.');
      }
      await syncMatriculaStatus({
        prisma: input.prisma,
        contaId: input.contaId,
        matriculaId: operation.matriculaId,
        targetStatus: 'CANCELADA',
        actorId: operation.actorId,
        motivo: operation.observacao ?? 'Reconciliação automática do cancelamento',
      });
      reconciled.push(operation.id);
    } catch (error) {
      errors.push({
        operationId: operation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { processed: operations.length, reconciled, errors };
}
