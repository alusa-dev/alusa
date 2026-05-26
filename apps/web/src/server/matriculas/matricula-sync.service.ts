import type { PrismaClient } from '@prisma/client';
import { StatusCobranca, StatusMatricula } from '@prisma/client';
import {
  ativarAssinatura,
  deletePayment,
  deleteSubscription,
  getPayment,
  getSubscription,
  pauseAssinatura,
} from '@alusa/finance';
import { AsaasHttpError } from '@alusa/finance';

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
};

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

export async function syncMatriculaStatus(input: SyncMatriculaStatusInput): Promise<SyncMatriculaStatusResult> {
  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: { id: true, status: true, asaasSubscriptionId: true },
  });

  if (!matricula) {
    throw new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada.');
  }

  const previousStatus = matricula.status;
  const newStatus = input.targetStatus as StatusMatricula;

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

  if (matricula.asaasSubscriptionId) {
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
        asaasResponse = await deleteSubscription(matricula.asaasSubscriptionId, { contaId: input.contaId });
      }
    } catch (error) {
      throw buildFinancialSyncError(input.targetStatus, matricula.asaasSubscriptionId, error);
    }
  }

  if (input.targetStatus === 'CANCELADA') {
    paymentSync = await syncOpenChargesForCancellation({
      prisma: input.prisma,
      matriculaId: matricula.id,
      contaId: input.contaId,
      actorId: input.actorId,
      motivo: input.motivo,
    });
  }

  await input.prisma.$transaction(async (tx) => {
    // Re-validate inside transaction for atomicity
    const verify = await tx.matricula.findFirst({
      where: { id: matricula.id, aluno: { contaId: input.contaId } },
      select: { id: true },
    });
    if (!verify) throw new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada durante a sincronização.');

    await tx.matricula.update({
      where: { id: matricula.id },
      data: { status: newStatus },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_STATUS_SYNC',
        metadata: {
          previousStatus,
          newStatus,
          motivo: input.motivo ?? null,
          asaasAction,
          cobrancasAtualizadas: paymentSync.updated,
          paymentWarnings: paymentSync.warnings,
        },
      },
    });
  });

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
  };
}
