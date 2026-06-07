import type { PrismaClient } from '@prisma/client';
import { StatusMatricula } from '@prisma/client';
import {
  pauseAssinatura,
  ativarAssinatura,
  getSubscription,
  listSubscriptionPayments,
  deletePayment,
  getPayment,
  updatePayment,
} from '@alusa/finance';
import { AsaasHttpError } from '@alusa/finance';
import { validatePausa, validateReativacao, validarCapacidade } from '@alusa/domain';
import type { TurmaCapacidadeInfo } from '@alusa/domain';
import {
  cancelLocalFutureEnrollmentCharges,
  markEnrollmentFinanceDivergence,
} from './enrollment-finance-consistency.service';

// ============================================================================
// ERRORS
// ============================================================================

export class PausaBusinessError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 422, details?: unknown) {
    super(message);
    this.name = 'PausaBusinessError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ============================================================================
// TYPES
// ============================================================================

export type PausarMatriculaInput = {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  motivoPausa: string;
  dataInicioPausa: string; // YYYY-MM-DD
  dataRetornoPrevista?: string; // YYYY-MM-DD
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  observacao?: string;
};

export type PausarMatriculaResult = {
  matriculaId: string;
  operacaoId: string;
  correlationId: string;
  previousStatus: StatusMatricula;
  newStatus: 'PAUSADA';
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  integrationStatus: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode: string | null;
  asaasAction: 'SUBSCRIPTION_INACTIVATED' | 'LOCAL_ONLY' | 'SKIPPED_COBRAR_DURANTE_PAUSA';
  cobrancasFuturasRemovidas: number;
  warnings: string[];
};

export type ReativarMatriculaInput = {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  dataRetornoEfetiva: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD - Obrigatório para retomada da assinatura
  observacao?: string;
};

export type ReativarMatriculaResult = {
  matriculaId: string;
  operacaoId: string;
  correlationId: string;
  previousStatus: StatusMatricula;
  newStatus: 'ATIVA';
  integrationStatus: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode: string | null;
  asaasAction: 'SUBSCRIPTION_UPDATED' | 'LOCAL_ONLY';
  warnings: string[];
};

const EDITABLE_SUBSCRIPTION_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);

// ============================================================================
// HELPER: Build financial error
// ============================================================================

function buildFinancialError(action: string, subscriptionId: string, error: unknown): PausaBusinessError {
  if (error instanceof AsaasHttpError) {
    const body = error.responseBody as Record<string, unknown> | null;
    const providerMessage = extractProviderMessage(body);

    if (error.status === 404) {
      return new PausaBusinessError(
        'ASSINATURA_NAO_ENCONTRADA',
        `Não foi possível ${action} a matrícula porque a assinatura financeira vinculada não foi encontrada.`,
        409,
        { status: error.status, subscriptionId, providerMessage },
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new PausaBusinessError(
        'ASAAS_AUTH_INVALIDA',
        `Não foi possível ${action} a matrícula porque a conta financeira da instituição não autorizou a operação.`,
        502,
        { status: error.status, subscriptionId, providerMessage },
      );
    }
    return new PausaBusinessError(
      'DIVERGENCIA_INTEGRACAO',
      providerMessage
        ? `Não foi possível ${action} a matrícula: ${providerMessage}`
        : `Não foi possível ${action} a matrícula porque o serviço financeiro rejeitou a operação.`,
      502,
      { status: error.status, subscriptionId, providerMessage },
    );
  }

  return new PausaBusinessError(
    'DIVERGENCIA_INTEGRACAO',
    `Não foi possível ${action} a matrícula: falha inesperada ao comunicar com o serviço financeiro.`,
    502,
    { subscriptionId, originalError: error instanceof Error ? error.message : String(error) },
  );
}

function extractProviderMessage(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.errors)) {
    return body.errors
      .map((e: unknown) => {
        if (!e || typeof e !== 'object') return null;
        const item = e as Record<string, unknown>;
        return typeof item.description === 'string' ? item.description : typeof item.message === 'string' ? item.message : null;
      })
      .filter(Boolean)
      .join(', ') || null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getBooleanValue(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function parsePausePayload(payload: unknown): {
  dataInicioPausa: string | null;
  dataRetornoPrevista: string | null;
  motivoPausa: string | null;
  manterVaga: boolean | undefined;
  cobrarDurantePausa: boolean | undefined;
} {
  if (!isRecord(payload)) {
    return {
      dataInicioPausa: null,
      dataRetornoPrevista: null,
      motivoPausa: null,
      manterVaga: undefined,
      cobrarDurantePausa: undefined,
    };
  }

  return {
    dataInicioPausa: getStringValue(payload, 'dataInicioPausa'),
    dataRetornoPrevista: getStringValue(payload, 'dataRetornoPrevista'),
    motivoPausa: getStringValue(payload, 'motivoPausa'),
    manterVaga: getBooleanValue(payload, 'manterVaga'),
    cobrarDurantePausa: getBooleanValue(payload, 'cobrarDurantePausa'),
  };
}

function parseIsoDateAtNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function pickNextGeneratedPaymentForReactivation(
  payments: Array<{ id: string; status: string; dueDate: string }>,
  dataRetornoEfetiva: string,
): { id: string; status: string; dueDate: string } | null {
  const candidate = payments
    .filter(
      (payment) =>
        EDITABLE_SUBSCRIPTION_PAYMENT_STATUSES.has(payment.status) &&
        payment.dueDate >= dataRetornoEfetiva,
    )
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];

  return candidate ?? null;
}

async function alignPendingPaymentAfterReactivation(input: {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  subscriptionId: string;
  dataRetornoEfetiva: string;
  nextDueDate: string;
}): Promise<{ updatedPaymentId: string | null }> {
  const subscriptionPayments = await listSubscriptionPayments(input.subscriptionId, {
    contaId: input.contaId,
    limit: 100,
  });

  const nextGeneratedPayment = pickNextGeneratedPaymentForReactivation(
    subscriptionPayments.data,
    input.dataRetornoEfetiva,
  );

  if (!nextGeneratedPayment || nextGeneratedPayment.dueDate === input.nextDueDate) {
    return { updatedPaymentId: null };
  }

  const currentPayment = await getPayment(nextGeneratedPayment.id, {
    contaId: input.contaId,
  });

  if (!EDITABLE_SUBSCRIPTION_PAYMENT_STATUSES.has(currentPayment.status)) {
    return { updatedPaymentId: null };
  }

  await updatePayment(
    currentPayment.id,
    {
      billingType: currentPayment.billingType,
      value: Number(currentPayment.value),
      dueDate: input.nextDueDate,
      description: currentPayment.description ?? undefined,
      externalReference: currentPayment.externalReference ?? undefined,
    },
    { contaId: input.contaId },
  );

  await input.prisma.cobranca.updateMany({
    where: {
      matriculaId: input.matriculaId,
      asaasPaymentId: currentPayment.id,
    },
    data: {
      vencimento: parseIsoDateAtNoon(input.nextDueDate),
    },
  });

  return { updatedPaymentId: currentPayment.id };
}

async function reconcileMatriculaPendingSynchronization(input: {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
}): Promise<void> {
  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      status: true,
      pausaAtiva: true,
      dataInicioPausa: true,
      dataRetornoPrevista: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      motivoPausa: true,
      integrationStatus: true,
      warningCode: true,
      asaasSubscriptionId: true,
      version: true,
    },
  });

  if (!matricula?.asaasSubscriptionId) {
    return;
  }

  const pendingOperations = await input.prisma.matriculaOperacao.findMany({
    where: {
      matriculaId: input.matriculaId,
      status: 'PENDENTE_SINCRONISMO',
      tipo: { in: ['PAUSA', 'REATIVACAO'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tipo: true,
      correlationId: true,
      createdAt: true,
      actorId: true,
      payloadEnviado: true,
    },
  });

  if (pendingOperations.length === 0) {
    return;
  }

  const remoteSubscription = await getSubscription(matricula.asaasSubscriptionId, {
    contaId: input.contaId,
  });

  if (remoteSubscription.deleted || (remoteSubscription.status !== 'ACTIVE' && remoteSubscription.status !== 'INACTIVE')) {
    return;
  }

  const now = new Date();
  const pendingPauseOperations = pendingOperations.filter((operation) => operation.tipo === 'PAUSA');
  const pendingReactivationOperations = pendingOperations.filter((operation) => operation.tipo === 'REATIVACAO');

  if (remoteSubscription.status === 'INACTIVE') {
    const latestPauseOperation = pendingPauseOperations[0] ?? null;
    const pausePayload = latestPauseOperation ? parsePausePayload(latestPauseOperation.payloadEnviado) : null;

    await input.prisma.$transaction(async (tx) => {
      await tx.matricula.update({
        where: { id: matricula.id, version: matricula.version },
        data: {
          status: 'PAUSADA',
          pausaAtiva: true,
          dataInicioPausa: pausePayload?.dataInicioPausa
            ? new Date(pausePayload.dataInicioPausa)
            : matricula.dataInicioPausa,
          dataRetornoPrevista:
            pausePayload?.dataRetornoPrevista !== null && pausePayload?.dataRetornoPrevista !== undefined
              ? new Date(pausePayload.dataRetornoPrevista)
              : matricula.dataRetornoPrevista,
          manterVaga: pausePayload?.manterVaga ?? matricula.manterVaga,
          cobrarDurantePausa: pausePayload?.cobrarDurantePausa ?? matricula.cobrarDurantePausa,
          motivoPausa: pausePayload?.motivoPausa ?? matricula.motivoPausa,
          integrationStatus: 'SINCRONIZADO',
          warningCode: null,
          version: { increment: 1 },
        },
      });

      if (pendingPauseOperations.length > 0) {
        await tx.matriculaOperacao.updateMany({
          where: {
            matriculaId: matricula.id,
            tipo: 'PAUSA',
            status: 'PENDENTE_SINCRONISMO',
          },
          data: {
            status: 'SINCRONIZADO',
            erro: null,
            processedAt: now,
          },
        });
      }

      if (pendingReactivationOperations.length > 0) {
        await tx.matriculaOperacao.updateMany({
          where: {
            matriculaId: matricula.id,
            tipo: 'REATIVACAO',
            status: 'PENDENTE_SINCRONISMO',
          },
          data: {
            status: 'ERRO',
            erro: 'Operação superada: a assinatura permanece inativa no Asaas.',
            processedAt: now,
          },
        });
      }

      await tx.matriculaLog.create({
        data: {
          matriculaId: matricula.id,
          actorId: latestPauseOperation?.actorId ?? pendingReactivationOperations[0]?.actorId ?? null,
          action: 'MATRICULA_PAUSA_RECONCILIADA',
          metadata: {
            asaasSubscriptionId: matricula.asaasSubscriptionId,
            remoteStatus: remoteSubscription.status,
            reconciledAt: now.toISOString(),
            pendingPauseCount: pendingPauseOperations.length,
            invalidatedReactivationCount: pendingReactivationOperations.length,
          },
        },
      });
    });

    return;
  }

  const latestReactivationOperation = pendingReactivationOperations[0] ?? null;

  await input.prisma.$transaction(async (tx) => {
    await tx.matricula.update({
      where: { id: matricula.id, version: matricula.version },
      data: {
        status: 'ATIVA',
        pausaAtiva: false,
        dataInicioPausa: null,
        dataRetornoPrevista: null,
        manterVaga: true,
        cobrarDurantePausa: false,
        motivoPausa: null,
        integrationStatus: 'SINCRONIZADO',
        warningCode: null,
        version: { increment: 1 },
      },
    });

    if (pendingReactivationOperations.length > 0) {
      await tx.matriculaOperacao.updateMany({
        where: {
          matriculaId: matricula.id,
          tipo: 'REATIVACAO',
          status: 'PENDENTE_SINCRONISMO',
        },
        data: {
          status: 'SINCRONIZADO',
          erro: null,
          processedAt: now,
        },
      });
    }

    if (pendingPauseOperations.length > 0) {
      await tx.matriculaOperacao.updateMany({
        where: {
          matriculaId: matricula.id,
          tipo: 'PAUSA',
          status: 'PENDENTE_SINCRONISMO',
        },
        data: {
          status: 'ERRO',
          erro: 'Operação superada: a assinatura já está ativa no Asaas.',
          processedAt: now,
        },
      });
    }

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: latestReactivationOperation?.actorId ?? pendingPauseOperations[0]?.actorId ?? null,
        action: 'MATRICULA_REATIVACAO_RECONCILIADA',
        metadata: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          remoteStatus: remoteSubscription.status,
          reconciledAt: now.toISOString(),
          pendingReactivationCount: pendingReactivationOperations.length,
          invalidatedPauseCount: pendingPauseOperations.length,
        },
      },
    });
  });
}

// ============================================================================
// PAUSAR MATRÍCULA
// ============================================================================

export async function pausarMatricula(input: PausarMatriculaInput): Promise<PausarMatriculaResult> {
  await reconcileMatriculaPendingSynchronization({
    prisma: input.prisma,
    matriculaId: input.matriculaId,
    contaId: input.contaId,
  });

  const operacaoPendente = await input.prisma.matriculaOperacao.findFirst({
    where: {
      matriculaId: input.matriculaId,
      tipo: 'PAUSA',
      status: 'PENDENTE_SINCRONISMO',
    },
    select: { id: true, correlationId: true, createdAt: true },
  });

  if (operacaoPendente) {
    throw new PausaBusinessError(
      'OPERACAO_DUPLICADA',
      'Já existe uma solicitação de pausa em processamento para esta matrícula.',
      409,
      {
        operacaoId: operacaoPendente.id,
        correlationId: operacaoPendente.correlationId,
        createdAt: operacaoPendente.createdAt,
      },
    );
  }

  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      status: true,
      pausaAtiva: true,
      asaasSubscriptionId: true,
      version: true,
      turmaId: true,
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  // Validação de domínio
  const validacao = validatePausa(matricula.status, matricula.pausaAtiva);
  if (!validacao.success) {
    const msgs: Record<string, string> = {
      MATRICULA_NAO_ATIVA: 'A matrícula precisa estar com status Ativa para ser pausada.',
      MATRICULA_JA_PAUSADA: 'A matrícula já se encontra pausada.',
    };
    throw new PausaBusinessError(validacao.error, msgs[validacao.error] ?? validacao.error);
  }

  // Criar operação local PENDENTE_SINCRONISMO
  const operacao = await input.prisma.matriculaOperacao.create({
    data: {
      matriculaId: matricula.id,
      contaId: input.contaId,
      tipo: 'PAUSA',
      origem: 'USER',
      status: 'PENDENTE_SINCRONISMO',
      actorId: input.actorId,
      observacao: input.observacao,
      payloadEnviado: {
        motivoPausa: input.motivoPausa,
        dataInicioPausa: input.dataInicioPausa,
        dataRetornoPrevista: input.dataRetornoPrevista ?? null,
        manterVaga: input.manterVaga,
        cobrarDurantePausa: input.cobrarDurantePausa,
      },
    },
  });

  const warnings: string[] = [];
  let asaasAction: PausarMatriculaResult['asaasAction'] = 'LOCAL_ONLY';
  let integrationStatus: PausarMatriculaResult['integrationStatus'] = 'SINCRONIZADO' as PausarMatriculaResult['integrationStatus'];
  let warningCode: string | null = null;
  let cobrancasFuturasRemovidas = 0;
  let deletedRemotePaymentIds: string[] = [];
  let failedRemotePaymentIds: string[] = [];
  let remoteDeletionUncertain = false;
  let localChargeAlignment = {
    scanned: 0,
    canceled: 0,
    pending: 0,
  };

  // Sincronizar com Asaas se houver assinatura e política de não cobrar
  if (matricula.asaasSubscriptionId) {
    if (input.cobrarDurantePausa) {
      asaasAction = 'SKIPPED_COBRAR_DURANTE_PAUSA';
    } else {
      // 1. Inativar assinatura no Asaas
      try {
        await pauseAssinatura({
          subscriptionId: matricula.asaasSubscriptionId,
          contaId: input.contaId,
        });
        asaasAction = 'SUBSCRIPTION_INACTIVATED';
      } catch (error) {
        // Registrar falha na operação
        await input.prisma.matriculaOperacao.update({
          where: { id: operacao.id },
          data: {
            status: 'ERRO',
            erro: error instanceof Error ? error.message : String(error),
            payloadRecebido: { error: true },
            processedAt: new Date(),
          },
        });
        throw buildFinancialError('pausar', matricula.asaasSubscriptionId, error);
      }

      // 2. Listar cobranças da assinatura e remover futuras não liquidadas
      try {
        const payments = await listSubscriptionPayments(
          matricula.asaasSubscriptionId,
          { contaId: input.contaId, limit: 100 },
        );

        const today = input.dataInicioPausa;
        const futurasIndevidas = payments.data.filter((p) => {
          const isPending = p.status === 'PENDING' || p.status === 'OVERDUE';
          const isFuture = p.dueDate >= today;
          return isPending && isFuture;
        });

        for (const payment of futurasIndevidas) {
          try {
            await deletePayment(payment.id, { contaId: input.contaId });
            deletedRemotePaymentIds.push(payment.id);
            cobrancasFuturasRemovidas++;
          } catch (deleteError) {
            failedRemotePaymentIds.push(payment.id);
            warnings.push(`Não foi possível remover a cobrança ${payment.id}: ${deleteError instanceof Error ? deleteError.message : 'erro desconhecido'}`);
          }
        }
      } catch (listError) {
        remoteDeletionUncertain = true;
        warnings.push(`Não foi possível listar cobranças da assinatura para remoção: ${listError instanceof Error ? listError.message : 'erro desconhecido'}`);
      }
    }

    integrationStatus = asaasAction === 'SUBSCRIPTION_INACTIVATED' ? 'PENDENTE_SINCRONISMO' : 'SINCRONIZADO';
  }

  if (warnings.length > 0) {
    warningCode = 'COBRANCAS_FUTURAS_NAO_REMOVIDAS';
  }

  // Atualizar matrícula
  let finalIntegrationStatus: PausarMatriculaResult['integrationStatus'] = integrationStatus;
  let finalWarningCode = warningCode;

  await input.prisma.$transaction(async (tx) => {
    if (!input.cobrarDurantePausa) {
      localChargeAlignment = await cancelLocalFutureEnrollmentCharges({
        db: tx,
        matriculaId: matricula.id,
        contaId: input.contaId,
        effectiveDate: input.dataInicioPausa,
        actor: { id: input.actorId },
        reason: input.motivoPausa,
        canceledRemotePaymentIds: deletedRemotePaymentIds,
        failedRemotePaymentIds,
        remoteDeletionUncertain,
      });

      if (localChargeAlignment.pending > 0) {
        finalIntegrationStatus = 'DIVERGENTE';
        finalWarningCode = 'COBRANCAS_FUTURAS_CANCELAMENTO_PENDENTE';
        warnings.push(
          'Algumas cobranças futuras ficaram pendentes de confirmação no Asaas e precisam de reconciliação.',
        );
      }
    }

    await tx.matricula.update({
      where: { id: matricula.id, version: matricula.version },
      data: {
        status: 'PAUSADA',
        pausaAtiva: true,
        dataInicioPausa: new Date(input.dataInicioPausa),
        dataRetornoPrevista: input.dataRetornoPrevista ? new Date(input.dataRetornoPrevista) : null,
        manterVaga: input.manterVaga,
        cobrarDurantePausa: input.cobrarDurantePausa,
        motivoPausa: input.motivoPausa,
        integrationStatus: finalIntegrationStatus,
        warningCode: finalWarningCode,
        version: { increment: 1 },
      },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_PAUSADA',
        metadata: {
          correlationId: operacao.correlationId,
          motivoPausa: input.motivoPausa,
          dataInicioPausa: input.dataInicioPausa,
          dataRetornoPrevista: input.dataRetornoPrevista ?? null,
          manterVaga: input.manterVaga,
          cobrarDurantePausa: input.cobrarDurantePausa,
          asaasAction,
          cobrancasFuturasRemovidas,
          localChargeAlignment,
          deletedRemotePaymentIds,
          failedRemotePaymentIds,
          remoteDeletionUncertain,
        },
      },
    });
  });

  integrationStatus = finalIntegrationStatus;
  warningCode = finalWarningCode;

  if (integrationStatus === 'DIVERGENTE') {
    try {
      await markEnrollmentFinanceDivergence({
        contaId: input.contaId,
        matriculaId: matricula.id,
        asaasSubscriptionId: matricula.asaasSubscriptionId,
        issue: 'PAYMENT_STATUS_DRIFT',
        severity: 'HIGH',
        localStatus: warningCode,
        remoteStatus: remoteDeletionUncertain ? 'UNKNOWN' : 'PARTIAL_FAILURE',
        metadata: {
          correlationId: operacao.correlationId,
          localChargeAlignment,
          deletedRemotePaymentIds,
          failedRemotePaymentIds,
          remoteDeletionUncertain,
        },
      });
    } catch (error) {
      console.error('[MATRICULA_PAUSA] Falha ao registrar divergência financeira:', error);
    }
  }

  // Atualizar operação
  await input.prisma.matriculaOperacao.update({
    where: { id: operacao.id },
    data: {
      status: integrationStatus === 'PENDENTE_SINCRONISMO' ? 'PENDENTE_SINCRONISMO' : 'SINCRONIZADO',
      payloadRecebido: {
        asaasAction,
        cobrancasFuturasRemovidas,
        localChargeAlignment,
        warnings,
      },
      processedAt: new Date(),
    },
  });

  return {
    matriculaId: matricula.id,
    operacaoId: operacao.id,
    correlationId: operacao.correlationId,
    previousStatus: matricula.status,
    newStatus: 'PAUSADA',
    manterVaga: input.manterVaga,
    cobrarDurantePausa: input.cobrarDurantePausa,
    integrationStatus,
    warningCode,
    asaasAction,
    cobrancasFuturasRemovidas,
    warnings,
  };
}

// ============================================================================
// REATIVAR MATRÍCULA
// ============================================================================

export async function reativarMatricula(input: ReativarMatriculaInput): Promise<ReativarMatriculaResult> {
  if (!input.nextDueDate) {
    throw new PausaBusinessError(
      'NEXT_DUE_DATE_OBRIGATORIO_PARA_REATIVAR',
      'É obrigatório informar a data da próxima cobrança ao reativar a matrícula.',
    );
  }

  await reconcileMatriculaPendingSynchronization({
    prisma: input.prisma,
    matriculaId: input.matriculaId,
    contaId: input.contaId,
  });

  const operacaoPendente = await input.prisma.matriculaOperacao.findFirst({
    where: {
      matriculaId: input.matriculaId,
      tipo: 'REATIVACAO',
      status: 'PENDENTE_SINCRONISMO',
    },
    select: { id: true, correlationId: true, createdAt: true },
  });

  if (operacaoPendente) {
    throw new PausaBusinessError(
      'OPERACAO_DUPLICADA',
      'Já existe uma solicitação de reativação em processamento para esta matrícula.',
      409,
      {
        operacaoId: operacaoPendente.id,
        correlationId: operacaoPendente.correlationId,
        createdAt: operacaoPendente.createdAt,
      },
    );
  }

  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      status: true,
      pausaAtiva: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      asaasSubscriptionId: true,
      version: true,
      turmaId: true,
      turma: {
        select: {
          id: true,
          nome: true,
          capacidade: true,
          _count: { select: { matriculas: { where: { status: { in: ['ATIVA', 'PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO'] } } } } },
        },
      },
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  // Validação de domínio: verifica se pode reativar + capacidade
  let capacidadeDisponivel: boolean | undefined;

  if (!matricula.manterVaga && matricula.turma) {
    const turmaInfo: TurmaCapacidadeInfo = {
      id: matricula.turma.id,
      nome: matricula.turma.nome,
      capacidade: matricula.turma.capacidade,
      matriculasOcupantes: matricula.turma._count.matriculas,
    };
    const capResult = validarCapacidade([turmaInfo]);
    capacidadeDisponivel = capResult.success;
  }

  const validacao = validateReativacao(matricula.status, matricula.manterVaga, capacidadeDisponivel);
  if (!validacao.success) {
    const msgs: Record<string, string> = {
      MATRICULA_NAO_PAUSADA: 'A matrícula precisa estar com status Pausada para ser reativada.',
      SEM_VAGA_PARA_REATIVACAO: 'Não há vaga disponível na turma para reativar esta matrícula. A pausa liberou a vaga e a turma está lotada.',
    };
    throw new PausaBusinessError(validacao.error, msgs[validacao.error] ?? validacao.error);
  }

  // Criar operação local
  const operacao = await input.prisma.matriculaOperacao.create({
    data: {
      matriculaId: matricula.id,
      contaId: input.contaId,
      tipo: 'REATIVACAO',
      origem: 'USER',
      status: 'PENDENTE_SINCRONISMO',
      actorId: input.actorId,
      observacao: input.observacao,
      payloadEnviado: {
        dataRetornoEfetiva: input.dataRetornoEfetiva,
        nextDueDate: input.nextDueDate,
      },
    },
  });

  const warnings: string[] = [];
  let asaasAction: ReativarMatriculaResult['asaasAction'] = 'LOCAL_ONLY';
  let integrationStatus: ReativarMatriculaResult['integrationStatus'] = 'SINCRONIZADO';
  let warningCode: string | null = null;
  let updatedPaymentId: string | null = null;

  if (matricula.asaasSubscriptionId && !matricula.cobrarDurantePausa) {
    try {
      await ativarAssinatura({
        subscriptionId: matricula.asaasSubscriptionId,
        contaId: input.contaId,
        nextDueDate: input.nextDueDate,
      });
      asaasAction = 'SUBSCRIPTION_UPDATED';
      integrationStatus = 'PENDENTE_SINCRONISMO'; // Aguardamos webhook de confirmação

      try {
        const paymentAlignment = await alignPendingPaymentAfterReactivation({
          prisma: input.prisma,
          matriculaId: matricula.id,
          contaId: input.contaId,
          subscriptionId: matricula.asaasSubscriptionId,
          dataRetornoEfetiva: input.dataRetornoEfetiva,
          nextDueDate: input.nextDueDate,
        });

        updatedPaymentId = paymentAlignment.updatedPaymentId;
        if (updatedPaymentId) {
          warnings.push('A cobrança já gerada da assinatura teve o vencimento atualizado para a data informada.');
        }
      } catch (error) {
        integrationStatus = 'DIVERGENTE';
        warningCode = 'COBRANCA_PENDENTE_NAO_ATUALIZADA';
        warnings.push(
          'A assinatura foi reativada, mas a cobrança já gerada não pôde ser atualizada automaticamente. Revise o próximo vencimento no financeiro.',
        );
      }
    } catch (error) {
      await input.prisma.matriculaOperacao.update({
        where: { id: operacao.id },
        data: {
          status: 'ERRO',
          erro: error instanceof Error ? error.message : String(error),
          payloadRecebido: { error: true },
          processedAt: new Date(),
        },
      });
      throw buildFinancialError('reativar', matricula.asaasSubscriptionId, error);
    }
  }

  // Atualizar matrícula
  await input.prisma.$transaction(async (tx) => {
    await tx.matricula.update({
      where: { id: matricula.id, version: matricula.version },
      data: {
        status: 'ATIVA',
        pausaAtiva: false,
        dataInicioPausa: null,
        dataRetornoPrevista: null,
        manterVaga: true,
        cobrarDurantePausa: false,
        motivoPausa: null,
        integrationStatus,
        warningCode,
        version: { increment: 1 },
      },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_REATIVADA',
        metadata: {
          correlationId: operacao.correlationId,
          dataRetornoEfetiva: input.dataRetornoEfetiva,
          nextDueDate: input.nextDueDate,
          asaasAction,
          warningCode,
          updatedPaymentId,
          warnings,
          manterVagaAnterior: matricula.manterVaga,
        },
      },
    });
  });

  await input.prisma.matriculaOperacao.update({
    where: { id: operacao.id },
    data: {
      status:
        integrationStatus === 'PENDENTE_SINCRONISMO'
          ? 'PENDENTE_SINCRONISMO'
          : integrationStatus === 'DIVERGENTE'
            ? 'ERRO'
            : 'SINCRONIZADO',
      erro:
        integrationStatus === 'DIVERGENTE'
          ? 'A assinatura foi reativada, mas a cobrança já gerada não pôde ser alinhada automaticamente.'
          : null,
      payloadRecebido: { asaasAction, warnings },
      processedAt: new Date(),
    },
  });

  return {
    matriculaId: matricula.id,
    operacaoId: operacao.id,
    correlationId: operacao.correlationId,
    previousStatus: matricula.status,
    newStatus: 'ATIVA',
    integrationStatus,
    warningCode,
    asaasAction,
    warnings,
  };
}

// ============================================================================
// RESUMO DE PAUSA
// ============================================================================

export type PausaResumoResult = {
  matriculaId: string;
  status: StatusMatricula;
  pausaAtiva: boolean;
  dataInicioPausa: string | null;
  dataRetornoPrevista: string | null;
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  motivoPausa: string | null;
  integrationStatus: string;
  warningCode: string | null;
  asaasSubscriptionId: string | null;
  operacoes: Array<{
    id: string;
    tipo: string;
    status: string;
    createdAt: string;
    processedAt: string | null;
    observacao: string | null;
    cobrancasFuturasRemovidas: number;
    warnings: string[];
  }>;
};

export async function getPausaResumo(
  prisma: PrismaClient,
  matriculaId: string,
  contaId: string,
): Promise<PausaResumoResult> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: {
      id: true,
      status: true,
      pausaAtiva: true,
      dataInicioPausa: true,
      dataRetornoPrevista: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      motivoPausa: true,
      integrationStatus: true,
      warningCode: true,
      asaasSubscriptionId: true,
      operacoes: {
        where: { tipo: { in: ['PAUSA', 'REATIVACAO'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          tipo: true,
          status: true,
          createdAt: true,
          processedAt: true,
          observacao: true,
          payloadRecebido: true,
        },
      },
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  return {
    matriculaId: matricula.id,
    status: matricula.status,
    pausaAtiva: matricula.pausaAtiva,
    dataInicioPausa: matricula.dataInicioPausa?.toISOString().slice(0, 10) ?? null,
    dataRetornoPrevista: matricula.dataRetornoPrevista?.toISOString().slice(0, 10) ?? null,
    manterVaga: matricula.manterVaga,
    cobrarDurantePausa: matricula.cobrarDurantePausa,
    motivoPausa: matricula.motivoPausa,
    integrationStatus: matricula.integrationStatus,
    warningCode: matricula.warningCode,
    asaasSubscriptionId: matricula.asaasSubscriptionId,
    operacoes: matricula.operacoes.map((op) => ({
      id: op.id,
      tipo: op.tipo,
      status: op.status,
      createdAt: op.createdAt.toISOString(),
      processedAt: op.processedAt?.toISOString() ?? null,
      observacao: op.observacao,
      cobrancasFuturasRemovidas:
        op.payloadRecebido &&
        typeof op.payloadRecebido === 'object' &&
        !Array.isArray(op.payloadRecebido) &&
        typeof (op.payloadRecebido as Record<string, unknown>).cobrancasFuturasRemovidas === 'number'
          ? Number((op.payloadRecebido as Record<string, unknown>).cobrancasFuturasRemovidas)
          : 0,
      warnings:
        op.payloadRecebido &&
        typeof op.payloadRecebido === 'object' &&
        !Array.isArray(op.payloadRecebido) &&
        Array.isArray((op.payloadRecebido as Record<string, unknown>).warnings)
          ? ((op.payloadRecebido as Record<string, unknown>).warnings as unknown[]).filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
    })),
  };
}
