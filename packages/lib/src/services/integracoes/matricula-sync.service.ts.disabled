import type {
  Prisma,
  PrismaClient,
  StatusCobranca,
  StatusMatricula,
  StatusTaxaMatricula,
} from '@prisma/client';
import {
  inactivateSubscription,
  reactivateSubscription,
  deleteSubscription,
  getPayment,
  isAsaasEnabled,
} from '../../asaas';
import { calcularProximoVencimento, formatDate } from '../../asaas/utils';
import { gerarSegundaVia, type SegundaViaResponse } from '../../asaas/financeiroService';
import { registrarLogFinanceiro, type AcaoFinanceira } from '../../asaas/logFinanceiro';

/**
 * Status de matrícula suportados para sincronização manual no dashboard.
 */
type MatriculaSyncTargetStatus = Extract<StatusMatricula, 'ATIVA' | 'PAUSADA' | 'CANCELADA'>;

const NOTIFICATION_ACTION_MAP: Record<
  MatriculaSyncTargetStatus,
  'PAUSADA' | 'RETOMADA' | 'CANCELADA'
> = {
  ATIVA: 'RETOMADA',
  PAUSADA: 'PAUSADA',
  CANCELADA: 'CANCELADA',
};

type AsaasAction = 'SUSPEND' | 'ACTIVATE' | 'DELETE' | 'LOCAL_ONLY' | 'NONE';

type ChargeSyncSource = 'ASAAS' | 'LOCAL';

interface ChargeSyncDetail {
  cobrancaId: string;
  asaasPaymentId: string | null;
  novoStatus: StatusCobranca;
  source: ChargeSyncSource;
}

const PAYMENT_STATUS_MAP: Record<string, StatusCobranca> = {
  PENDING: 'PENDENTE',
  RECEIVED: 'PAGO',
  RECEIVED_IN_CASH: 'PAGO',
  CONFIRMED: 'PROCESSANDO',
  OVERDUE: 'ATRASADO',
  REFUNDED: 'ESTORNADO',
  REFUND_REQUESTED: 'ESTORNADO',
  CHARGEBACK_REQUESTED: 'ESTORNADO',
  CHARGEBACK_DISPUTE: 'PROCESSANDO',
  AWAITING_CHARGEBACK_REVERSAL: 'PROCESSANDO',
  DUNNING_REQUESTED: 'PROCESSANDO',
  DUNNING_RECEIVED: 'PROCESSANDO',
  AWAITING_RISK_ANALYSIS: 'PROCESSANDO',
  DELETED: 'CANCELADO',
  CANCELED: 'CANCELADO',
  CANCELLED: 'CANCELADO',
} as const;

function mapPaymentStatus(status: string): StatusCobranca {
  return PAYMENT_STATUS_MAP[status] ?? 'PENDENTE';
}

function mapTaxaStatus(
  cobrancaStatus: StatusCobranca,
  previous?: StatusTaxaMatricula | null,
): StatusTaxaMatricula | null {
  switch (cobrancaStatus) {
    case 'PAGO':
      return 'PAGO';
    case 'PENDENTE':
    case 'PROCESSANDO':
      return 'PENDENTE';
    case 'ATRASADO':
      return 'EXPIRADO';
    case 'CANCELADO':
    case 'ESTORNADO':
      return previous === 'ISENTO' ? 'ISENTO' : 'EXPIRADO';
    default:
      return null;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class ManualSyncError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ManualSyncError';
  }
}

export interface SyncMatriculaStatusInput {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  targetStatus: MatriculaSyncTargetStatus;
  actorId?: string | null;
  motivo?: string;
}

export interface SyncMatriculaStatusResult {
  matriculaId: string;
  previousStatus: StatusMatricula;
  newStatus: StatusMatricula;
  asaasAction: AsaasAction;
  asaasResponse?: unknown;
  cobrancasAtualizadas: number;
  nextDueDate?: string | null;
  paymentSync: {
    totalFromAsaas: number;
    matched: number;
    updated: number;
    warnings: string[];
    details: ChargeSyncDetail[];
    expectedWebhooks: string[];
  };
}

export interface ResendTaxaMatriculaInput {
  prisma: PrismaClient;
  cobrancaId: string;
  contaId: string;
  actorId?: string | null;
}

export interface ResendTaxaMatriculaResult {
  cobrancaId: string;
  matriculaId: string;
  previousStatus: StatusCobranca;
  newStatus: StatusCobranca;
  newTaxaStatus?: StatusTaxaMatricula;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCode?: string | null;
  pixCopyPaste?: string | null;
}

const now = () => new Date();

export async function syncMatriculaStatus({
  prisma,
  matriculaId,
  contaId,
  targetStatus,
  actorId,
  motivo,
}: SyncMatriculaStatusInput): Promise<SyncMatriculaStatusResult> {
  if (!matriculaId || !contaId) {
    throw new ManualSyncError(400, 'INVALID_INPUT', 'matriculaId e contaId são obrigatórios.');
  }

  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: {
      id: true,
      status: true,
      taxaStatus: true,
      asaasSubscriptionId: true,
      vencimentoDia: true,
    },
  });

  if (!matricula) {
    throw new ManualSyncError(404, 'MATRICULA_NOT_FOUND', 'Matrícula não encontrada.');
  }

  console.log('[ASAAS_SYNC] Matrícula encontrada:', {
    id: matricula.id,
    status: matricula.status,
    asaasSubscriptionId: matricula.asaasSubscriptionId,
    targetStatus,
  });

  if (!matricula.asaasSubscriptionId) {
    throw new ManualSyncError(
      400,
      'ASSINATURA_NAO_ENCONTRADA',
      'Esta matrícula não possui assinatura no Asaas. Não é possível alterar o status.',
      { matriculaId, status: matricula.status },
    );
  }

  if (matricula.status === targetStatus) {
    return {
      matriculaId,
      previousStatus: matricula.status,
      newStatus: matricula.status,
      asaasAction: 'NONE',
      cobrancasAtualizadas: 0,
      nextDueDate: null,
      paymentSync: {
        totalFromAsaas: 0,
        matched: 0,
        updated: 0,
        warnings: ['Status atual já corresponde ao solicitado.'],
        details: [],
        expectedWebhooks: [],
      },
    };
  }

  if (targetStatus === 'PAUSADA' && matricula.status !== 'ATIVA') {
    throw new ManualSyncError(
      400,
      'STATUS_TRANSITION_NOT_ALLOWED',
      'Somente matrículas ativas podem ser pausadas.',
      { statusAtual: matricula.status, alvo: targetStatus },
    );
  }
  if (targetStatus === 'ATIVA' && matricula.status !== 'PAUSADA') {
    throw new ManualSyncError(
      400,
      'STATUS_TRANSITION_NOT_ALLOWED',
      'Somente matrículas pausadas podem ser retomadas.',
      { statusAtual: matricula.status, alvo: targetStatus },
    );
  }
  if (
    targetStatus === 'CANCELADA' &&
    !['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'].includes(matricula.status)
  ) {
    throw new ManualSyncError(
      400,
      'STATUS_TRANSITION_NOT_ALLOWED',
      'Cancelamento não é permitido para o status atual.',
      { statusAtual: matricula.status, alvo: targetStatus },
    );
  }

  const hasSubscription = Boolean(matricula.asaasSubscriptionId);
  const featureEnabled = isAsaasEnabled();
  const shouldCallAsaas = hasSubscription && featureEnabled;

  let asaasAction: AsaasAction = hasSubscription ? 'LOCAL_ONLY' : 'NONE';
  let asaasResponse: unknown = null;

  if (shouldCallAsaas) {
    try {
      console.log('[ASAAS_SYNC] Chamando Asaas:', {
        action: targetStatus,
        subscriptionId: matricula.asaasSubscriptionId,
        contaId,
      });

      if (targetStatus === 'PAUSADA') {
        asaasAction = 'SUSPEND';
        asaasResponse = await inactivateSubscription(matricula.asaasSubscriptionId!, { contaId });
        console.log('[ASAAS_SYNC] Assinatura inativada (status=INACTIVE):', asaasResponse);
      } else if (targetStatus === 'ATIVA') {
        asaasAction = 'ACTIVATE';
        // Calcular próxima data de vencimento ao reativar
        const diaVencimento = Math.min(Math.max(matricula.vencimentoDia ?? 5, 1), 28);
        const proximoVencimento = formatDate(calcularProximoVencimento(diaVencimento));
        asaasResponse = await reactivateSubscription(
          matricula.asaasSubscriptionId!, 
          proximoVencimento,
          { contaId }
        );
        console.log('[ASAAS_SYNC] Assinatura reativada (status=ACTIVE) com nextDueDate:', proximoVencimento, asaasResponse);
      } else if (targetStatus === 'CANCELADA') {
        asaasAction = 'DELETE';
        asaasResponse = await deleteSubscription(matricula.asaasSubscriptionId!, { contaId });
        console.log('[ASAAS_SYNC] Assinatura deletada:', asaasResponse);
      }
    } catch (error) {
      const statusCode = (error as any).response?.status;
      const asaasError = (error as any).response?.data;

      console.error('[ASAAS_SYNC] Erro ao chamar Asaas:', {
        error: (error as Error).message,
        response: asaasError,
        status: statusCode,
      });

      // Se retornou 404, a assinatura não existe mais no Asaas
      if (statusCode === 404) {
        console.warn('[ASAAS_SYNC] Assinatura não encontrada no Asaas (404). Continuando apenas localmente...');
        asaasAction = 'LOCAL_ONLY';
        // Limpar o asaasSubscriptionId do banco já que não existe mais no Asaas
        await prisma.matricula.update({
          where: { id: matriculaId },
          data: { asaasSubscriptionId: null },
        });
      } else {
        // Para outros erros, lançar exceção
        throw new ManualSyncError(502, 'ASAAS_ERROR', 'Falha ao sincronizar status com o Asaas.', {
          error: (error as Error).message,
          asaasError,
          asaasStatus: statusCode,
        });
      }
    }
  }

  const paymentSync = {
    totalFromAsaas: 0,
    matched: 0,
    updated: 0,
    warnings: [] as string[],
    details: [] as ChargeSyncDetail[],
    expectedWebhooks: [] as string[],
  };

  if (shouldCallAsaas) {
    paymentSync.warnings.push(
      'Status das cobranças será atualizado automaticamente via webhooks oficiais do Asaas.',
    );

    if (targetStatus === 'PAUSADA') {
      paymentSync.expectedWebhooks.push('SUBSCRIPTION_INACTIVATED');
    }
    if (targetStatus === 'ATIVA') {
      paymentSync.expectedWebhooks.push('SUBSCRIPTION_ACTIVATED', 'PAYMENT_CREATED');
    }
    if (targetStatus === 'CANCELADA') {
      paymentSync.expectedWebhooks.push('SUBSCRIPTION_DELETED', 'PAYMENT_DELETED');
    }
  } else if (hasSubscription) {
    paymentSync.warnings.push(
      'Integração Asaas desabilitada; assinatura será tratada quando o recurso estiver ativo.',
    );
  } else {
    paymentSync.warnings.push('Matrícula sem assinatura Asaas; nenhuma ação remota executada.');
  }

  const diaVencimento = Math.min(Math.max(matricula.vencimentoDia ?? 5, 1), 28);
  const nextDueDate =
    targetStatus === 'ATIVA' ? formatDate(calcularProximoVencimento(diaVencimento)) : null;

  await prisma.$transaction(async (tx) => {
    const agora = now();
    
    const updateData: any = {
      status: targetStatus,
      // dataFimContrato não é alterado ao sincronizar status
      updatedAt: agora,
    };

    // Se assinatura foi removida (404), já foi atualizado acima
    // Mas garantimos que está null
    if (asaasAction === 'LOCAL_ONLY' && !hasSubscription) {
      updateData.asaasSubscriptionId = null;
    }

    await tx.matricula.update({
      where: { id: matriculaId },
      data: updateData,
      select: { id: true, status: true },
    });

    // Registrar log da ação com motivo
    await tx.matriculaLog.create({
      data: {
        matriculaId,
        actorId: actorId ?? undefined,
        action: `STATUS_CHANGED_TO_${targetStatus}`,
        metadata: toJson({
          previousStatus: matricula.status,
          newStatus: targetStatus,
          motivo: motivo || null,
          asaasAction,
          asaasSubscriptionNotFound: asaasAction === 'LOCAL_ONLY' && hasSubscription,
          timestamp: agora.toISOString(),
        }),
      },
    });

    await tx.webhookAsaas.create({
      data: {
        contaId,
        evento: `SYNC_MANUAL_STATUS_${asaasAction}`,
        payload: toJson({
          matriculaId,
          previousStatus: matricula.status,
          newStatus: targetStatus,
          actorId,
          asaasAction,
          asaasResponse,
          paymentSync,
          nextDueDate,
          timestamp: agora.toISOString(),
        }),
        status: 'PROCESSADO',
        processadoEm: agora,
      },
    });
  });

  const acaoFinanceira: Record<MatriculaSyncTargetStatus, AcaoFinanceira | null> = {
    PAUSADA: 'PAUSAR',
    ATIVA: 'REATIVAR',
    CANCELADA: 'DELETAR',
  };

  if (actorId && acaoFinanceira[targetStatus]) {
    await registrarLogFinanceiro({
      contaId,
      usuarioId: actorId,
      acao: acaoFinanceira[targetStatus]!,
      detalhes: {
        matriculaId,
        previousStatus: matricula.status,
        newStatus: targetStatus,
        asaasAction,
        expectedWebhooks: paymentSync.expectedWebhooks,
        warnings: paymentSync.warnings,
        nextDueDate,
      },
    });
  }

  // Notificar responsável sobre a ação realizada
  if (asaasAction !== 'NONE' && asaasAction !== 'LOCAL_ONLY') {
    try {
      const { notifyMatriculaAction } = await import('../../notifications/matricula-notifications');
        await notifyMatriculaAction({
          matriculaId,
          action: NOTIFICATION_ACTION_MAP[targetStatus],
          motivo,
          contaId,
        });
      console.log(`[ASAAS_SYNC] Notificação de ${targetStatus} enviada/registrada`);
    } catch (notifyError) {
      console.error('[ASAAS_SYNC] Erro ao notificar responsável:', notifyError);
      // Não bloquear o fluxo se a notificação falhar
    }
  }

  console.info('[ASAAS_SYNC]', {
    matriculaId,
    status: targetStatus,
    result: {
      asaasAction,
      cobrancasAtualizadas: 0,
      paymentSync,
      nextDueDate,
    },
  });

  return {
    matriculaId,
    previousStatus: matricula.status,
    newStatus: targetStatus,
    asaasAction,
    asaasResponse,
    cobrancasAtualizadas: 0,
    nextDueDate,
    paymentSync,
  };
}

export async function resendTaxaMatricula({
  prisma,
  cobrancaId,
  contaId,
  actorId,
}: ResendTaxaMatriculaInput): Promise<ResendTaxaMatriculaResult> {
  if (!cobrancaId || !contaId) {
    throw new ManualSyncError(400, 'INVALID_INPUT', 'cobrancaId e contaId são obrigatórios.');
  }

  const cobranca = await prisma.cobranca.findFirst({
    where: { id: cobrancaId, matricula: { aluno: { contaId } } },
    select: {
      id: true,
      status: true,
      tipo: true,
      asaasPaymentId: true,
      matriculaId: true,
      matricula: {
        select: {
          id: true,
          taxaStatus: true,
        },
      },
    },
  });

  if (!cobranca) {
    throw new ManualSyncError(404, 'COBRANCA_NOT_FOUND', 'Cobrança não encontrada.');
  }

  if (cobranca.tipo !== 'TAXA_MATRICULA') {
    throw new ManualSyncError(
      400,
      'INVALID_CHARGE_TYPE',
      'Somente a taxa de matrícula pode ser reenviada por este endpoint.',
    );
  }

  if (!cobranca.asaasPaymentId) {
    throw new ManualSyncError(
      400,
      'ASAAS_PAYMENT_MISSING',
      'Cobrança não possui identificador no Asaas.',
    );
  }

  try {
    const segundaVia = await gerarSegundaVia({
      paymentId: cobranca.asaasPaymentId,
      contaId,
    });

    if (!segundaVia.success || !segundaVia.data) {
      throw new ManualSyncError(
        502,
        'ASAAS_ERROR',
        'Falha ao gerar links de pagamento para a taxa de matrícula.',
        { response: segundaVia },
      );
    }

    const links = segundaVia.data as SegundaViaResponse;
    const payment = await getPayment(cobranca.asaasPaymentId, { contaId });
    const novoStatus = mapPaymentStatus(payment.status ?? 'PENDING');
    const novoTaxaStatus = mapTaxaStatus(novoStatus, cobranca.matricula.taxaStatus);

    const agora = now();

    await prisma.$transaction(async (tx) => {
      if (novoStatus !== cobranca.status) {
        await tx.cobranca.update({
          where: { id: cobranca.id },
          data: { status: novoStatus, updatedAt: agora },
        });
      }

      if (novoTaxaStatus && novoTaxaStatus !== cobranca.matricula.taxaStatus) {
        await tx.matricula.update({
          where: { id: cobranca.matriculaId },
          data: { taxaStatus: novoTaxaStatus, updatedAt: agora },
        });
      }

      await tx.matriculaLog.create({
        data: {
          matriculaId: cobranca.matriculaId,
          actorId: actorId ?? undefined,
          action: 'TAXA_REENVIADA',
          metadata: toJson({
            cobrancaId,
            previousCobrancaStatus: cobranca.status,
            newCobrancaStatus: novoStatus,
            previousTaxaStatus: cobranca.matricula.taxaStatus,
            newTaxaStatus: novoTaxaStatus ?? null,
            invoiceUrl: links.invoiceUrl ?? null,
            bankSlipUrl: links.bankSlipUrl ?? null,
            pixQrCodeUrl: links.pixQrCodeUrl ?? null,
            pixCopyPaste: links.pixCopyPaste ?? null,
            generatedAt: agora.toISOString(),
          }),
        },
      });

      await tx.webhookAsaas.create({
        data: {
          contaId,
          evento: 'SYNC_MANUAL_RESEND_PAYMENT',
          payload: toJson({
            cobrancaId,
            matriculaId: cobranca.matriculaId,
            previousStatus: cobranca.status,
            expectedStatusFromWebhook: novoStatus,
            paymentStatus: payment.status,
            invoiceUrl: links.invoiceUrl,
            bankSlipUrl: links.bankSlipUrl,
            pixQrCodeUrl: links.pixQrCodeUrl,
            pixCopyPaste: links.pixCopyPaste,
            actorId,
            newTaxaStatus: novoTaxaStatus ?? null,
            timestamp: agora.toISOString(),
          }),
          status: 'PROCESSADO',
          processadoEm: agora,
        },
      });
    });

    if (actorId) {
      await registrarLogFinanceiro({
        contaId,
        usuarioId: actorId,
        cobrancaId,
        acao: 'REENVIAR',
        detalhes: {
          matriculaId: cobranca.matriculaId,
          previousStatus: cobranca.status,
          paymentStatus: payment.status,
          newTaxaStatus: novoTaxaStatus ?? null,
          links,
        },
      });
    }

    console.info('[ASAAS_SYNC]', {
      matriculaId: cobranca.matriculaId,
      status: 'TAXA_LINKS_GERADOS',
      result: {
        cobrancaId,
        expectedStatus: novoStatus,
        newTaxaStatus: novoTaxaStatus ?? null,
      },
    });

    return {
      cobrancaId,
      matriculaId: cobranca.matriculaId,
      previousStatus: cobranca.status,
      newStatus: novoStatus,
      newTaxaStatus: novoTaxaStatus ?? undefined,
      invoiceUrl: links.invoiceUrl ?? null,
      bankSlipUrl: links.bankSlipUrl ?? null,
      pixQrCode: links.pixQrCodeUrl ?? null,
      pixCopyPaste: links.pixCopyPaste ?? null,
    };
  } catch (error) {
    if (error instanceof ManualSyncError) {
      throw error;
    }
    throw new ManualSyncError(502, 'ASAAS_ERROR', 'Falha ao gerar links da cobrança no Asaas.', {
      error: (error as Error).message,
    });
  }
}
