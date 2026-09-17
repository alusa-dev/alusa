import { Prisma } from '@prisma/client';
import { syncEnrollmentNotifications } from './enrollment-notifications.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { matriculaRouteRepository } from './matricula-route.repository';
import { criarMatricula, buscarMatriculaPorId } from './matricula.service';
import { processEnrollmentBillingOutboxEvent } from './enrollment-billing-outbox.service';
import { createImmediateEnrollment, ImmediateEnrollmentCreationError } from './create-immediate-enrollment.use-case';
import {
  createMatriculaInputDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import type {
  MatriculaOperationalWarningDTO,
  MatriculaAsaasSubscriptionSyncDTO,
  MatriculaAsaasTaxaSyncDTO,
} from '@/features/cadastro/matriculas/dtos';
import { mapCreateMatriculaDTOToServiceInput, mapCreateMatriculaResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { formatIsoDate, isDateOnlyBefore, resolveChargeableFirstDueDate } from './recurring-billing';
import { isSupportedAsaasBillingType, resolveWizardPaymentSelection } from './payment-selection';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';
import type { StagedEnrollmentFinancialResources } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export function isPrismaClientInfrastructureError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientValidationError
    || error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError;
}

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function errorResult(status: number, code: string, message: string, details?: unknown) {
  return { kind: 'HTTP_ERROR' as const, response: apiJsonError(status, code, message, details) };
}

async function rejectUnconfirmedEnrollment(input: {
  contaId: string;
  matriculaId: string;
  actorId: string;
  reason: string;
  requiresReconciliation: boolean;
}) {
  await matriculaRouteRepository.$transaction(async (tx) => {
    const enrollment = await tx.matricula.findFirst({
      where: { id: input.matriculaId, contaId: input.contaId },
      select: { id: true, contratoAtualId: true },
    });
    if (!enrollment) return;

    await tx.matricula.updateMany({
      where: { id: enrollment.id, contaId: input.contaId },
      data: {
        status: 'RECUSADA',
        statusFinanceiro: 'SUSPENSO',
        statusContrato: 'CANCELADO',
        billingProvisionStatus: input.requiresReconciliation ? 'RESULTADO_INCERTO' : 'FALHO',
        billingProvisionError: input.reason.slice(0, 2000),
      },
    });
    if (enrollment.contratoAtualId) {
      await tx.contrato.updateMany({
        where: { id: enrollment.contratoAtualId, contaId: input.contaId, status: { notIn: ['ASSINADO', 'CANCELADO'] } },
        data: { status: 'CANCELADO' },
      });
    }
    await tx.matriculaLog.create({
      data: {
        matriculaId: enrollment.id,
        actorId: input.actorId,
        action: 'MATRICULA_RECUSADA_FINANCEIRO_NAO_CONFIRMADO',
        metadata: { reason: input.reason, requiresReconciliation: input.requiresReconciliation } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function createMatriculaHttp(params: {
  rawBody: unknown;
  idempotencyKey: string | null;
}) {
  const parsedBody = createMatriculaInputDTOSchema.safeParse(params.rawBody);
  if (!parsedBody.success) {
    return errorResult(400, 'PAYLOAD_INVALIDO', parsedBody.error.issues[0]?.message ?? 'Payload inválido', parsedBody.error.issues);
  }

  const auth = await resolveTenantSession(parsedBody.data.contaId ?? null);
  if (!auth.ok) {
    return auth.reason === 'CONTA_MISMATCH'
      ? errorResult(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.')
      : errorResult(403, 'CONTA_SESSAO_OBRIGATORIA', 'A conta ativa precisa estar vinculada à sessão do usuário.');
  }
  if (!auth.contaId) return errorResult(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
  if (!auth.userId) return errorResult(403, 'USUARIO_NAO_AUTENTICADO', 'Usuário não autenticado ou ID não encontrado.');
  if (!auth.role) return errorResult(403, 'PAPEL_USUARIO_NAO_DEFINIDO', 'Papel do usuário não está definido.');
  if (!allowedRoles.has(auth.role.toUpperCase())) {
    return errorResult(403, 'PERMISSAO_NEGADA', `Usuário com papel "${auth.role}" não tem permissão para criar matrículas.`);
  }

  try {
    await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ENROLLMENT_WRITE' });
  } catch (error) {
    const blocked = platformBillingAccessResponse(error);
    if (blocked) return errorResult(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
    throw error;
  }

  const paymentSelection = resolveWizardPaymentSelection({
    formaPagamento: parsedBody.data.formaPagamento,
    formaPagamentoTaxa: parsedBody.data.formaPagamentoTaxa,
  });
  if (paymentSelection.invalidFormaPagamento) return errorResult(422, 'FORMA_PAGAMENTO_INVALIDA', 'Forma de pagamento da mensalidade é inválida.');
  if (paymentSelection.invalidFormaPagamentoTaxa) return errorResult(422, 'FORMA_PAGAMENTO_TAXA_INVALIDA', 'Forma de pagamento da taxa de matrícula é inválida.');

  const commitIdempotencyKey = parsedBody.data.uiRequestId ?? params.idempotencyKey;
  if (!commitIdempotencyKey) return errorResult(400, 'IDEMPOTENCY_KEY_OBRIGATORIA', 'Informe uma chave de idempotência para confirmar a matrícula.');

  const previewExpiresAt = parsedBody.data.previewExpiresAt instanceof Date
    ? parsedBody.data.previewExpiresAt
    : new Date(parsedBody.data.previewExpiresAt);
  if (Number.isNaN(previewExpiresAt.getTime())) return errorResult(400, 'PREVIEW_EXPIRACAO_INVALIDA', 'Expiração do preview inválida.');
  if (previewExpiresAt <= new Date()) return errorResult(409, 'PREVIEW_EXPIRADO', 'O preview da matrícula expirou. Gere um novo preview antes de confirmar.');

  let payload;
  try {
    payload = mapCreateMatriculaDTOToServiceInput({
      body: parsedBody.data,
      contaId: auth.contaId,
      createdById: auth.userId,
      uiRequestId: commitIdempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload inválido';
    return message === 'dataFimContrato é obrigatório.'
      ? errorResult(400, 'DATA_FIM_CONTRATO_OBRIGATORIA', message)
      : errorResult(400, 'PAYLOAD_INVALIDO', message);
  }

  const willCreateSubscription = payload.criarCobranca === true;
  const willCreateEnrollmentFee = payload.gerarCobrancaTaxa === true && !payload.taxaIsenta && payload.taxaMatricula > 0;
  if (willCreateSubscription && !isSupportedAsaasBillingType(paymentSelection.billingType)) return errorResult(422, 'FORMA_PAGAMENTO_INVALIDA', 'Forma de pagamento da mensalidade não suporta cobrança no Asaas.');
  if (willCreateEnrollmentFee && !isSupportedAsaasBillingType(paymentSelection.billingTypeTaxa)) return errorResult(422, 'FORMA_PAGAMENTO_TAXA_INVALIDA', 'Forma de pagamento da taxa de matrícula não suporta cobrança no Asaas.');
  if (willCreateEnrollmentFee && !willCreateSubscription) return errorResult(422, 'ASSINATURA_OBRIGATORIA_PARA_MATRICULA_FINANCEIRA', 'A taxa de matrícula só pode ser confirmada junto com a assinatura da mensalidade.');

  if (willCreateSubscription) {
    const previewNextDueDate = resolveChargeableFirstDueDate(payload.dataInicio, payload.vencimentoDia);
    if (isDateOnlyBefore(payload.dataFimContrato, previewNextDueDate)) {
      return errorResult(422, 'DATA_FIM_INVALIDA', `A data de término do contrato (${formatIsoDate(payload.dataFimContrato)}) precisa ser igual ou posterior ao primeiro vencimento (${formatIsoDate(previewNextDueDate)}). Ajuste a data de término ou o dia de vencimento.`);
    }
  }

  const usesSeparateSubscription = !payload.billingStrategy || payload.billingStrategy.kind === 'SEPARATE';
  const operationResult = willCreateSubscription && usesSeparateSubscription
    ? await createImmediateEnrollment(payload)
    : await criarMatricula(payload);
  let billingOutboxResult: Awaited<ReturnType<typeof processEnrollmentBillingOutboxEvent>> | null = null;
  const billingOutboxEventId = (operationResult as { billingOutboxEventId?: string | null }).billingOutboxEventId ?? null;
  if (billingOutboxEventId) {
    billingOutboxResult = await processEnrollmentBillingOutboxEvent(billingOutboxEventId);
    const skippedButAlreadyConfirmed = billingOutboxResult.status === 'SKIPPED' && Boolean(
      await matriculaRouteRepository.matricula.findFirst({
        where: { id: operationResult.matricula.id, contaId: auth.contaId, billingProvisionStatus: 'PROVISIONADO' },
        select: { id: true },
      }),
    );
    if (willCreateSubscription && !usesSeparateSubscription && billingOutboxResult.status !== 'PROCESSED' && !skippedButAlreadyConfirmed) {
      const requiresReconciliation = billingOutboxResult.status === 'REQUIRES_RECONCILIATION';
      const reason = billingOutboxResult.error ?? (requiresReconciliation ? 'A alteração da assinatura existente teve resultado incerto.' : 'A alteração da assinatura existente não foi confirmada.');
      await rejectUnconfirmedEnrollment({ contaId: auth.contaId, matriculaId: operationResult.matricula.id, actorId: auth.userId, reason, requiresReconciliation });
      throw new ImmediateEnrollmentCreationError(
        requiresReconciliation ? 'UNIFICACAO_REQUER_RECONCILIACAO' : 'UNIFICACAO_FINANCEIRA_NAO_CONFIRMADA',
        requiresReconciliation
          ? 'A alteração financeira precisa de reconciliação. A matrícula não foi ativada e a vaga foi liberada.'
          : 'Não foi possível confirmar a alteração da assinatura. A matrícula não foi ativada.',
        requiresReconciliation,
      );
    }
    const refreshed = await buscarMatriculaPorId({ id: operationResult.matricula.id, contaId: auth.contaId });
    if (refreshed) operationResult.matricula = refreshed;
  }

  const notificationSync = await syncEnrollmentNotifications({
    contaId: auth.contaId,
    matriculaId: operationResult.matricula.id,
    actorId: auth.userId,
    correlationId: payload.uiRequestId,
    channels: payload.notificationChannels,
    configured: payload.notificationChannelsConfigured,
  });
  const operationalWarnings: MatriculaOperationalWarningDTO[] = [];
  const immediateSync = 'immediateFinancialSync' in operationResult
    ? (operationResult as { immediateFinancialSync: { subscription: StagedEnrollmentFinancialResources['subscription']; enrollmentFee: StagedEnrollmentFinancialResources['enrollmentFee'] } }).immediateFinancialSync
    : null;
  let taxaSync: MatriculaAsaasTaxaSyncDTO | null = immediateSync?.enrollmentFee
    ? { success: true, asaasPaymentId: immediateSync.enrollmentFee.asaasPaymentId, invoiceUrl: immediateSync.enrollmentFee.invoiceUrl, bankSlipUrl: immediateSync.enrollmentFee.bankSlipUrl }
    : null;
  let subscriptionSync: MatriculaAsaasSubscriptionSyncDTO | null = immediateSync
    ? { success: true, asaasSubscriptionId: immediateSync.subscription.asaasSubscriptionId, asaasPaymentId: immediateSync.subscription.firstPayment.asaasPaymentId, invoiceUrl: immediateSync.subscription.firstPayment.invoiceUrl, bankSlipUrl: immediateSync.subscription.firstPayment.bankSlipUrl, expectedWebhooks: [], message: 'Assinatura e primeira mensalidade confirmadas no Asaas.' }
    : null;
  const currentBillingProvisionStatus = String(operationResult.matricula.billingProvisionStatus ?? 'NAO_APLICAVEL');
  if ((willCreateEnrollmentFee || willCreateSubscription) && ['PENDENTE', 'PROCESSANDO', 'PARCIAL', 'FALHO', 'RESULTADO_INCERTO'].includes(currentBillingProvisionStatus)) {
    const isFailure = currentBillingProvisionStatus === 'FALHO' || currentBillingProvisionStatus === 'RESULTADO_INCERTO' || billingOutboxResult?.status === 'FAILED' || billingOutboxResult?.status === 'REQUIRES_RECONCILIATION';
    operationalWarnings.push({ type: 'FINANCIAL_PROVISION_PENDING', code: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO', message: isFailure ? 'Matrícula salva. O financeiro precisa de conferência antes de continuar.' : 'Matrícula salva. O financeiro está sincronizando automaticamente.', severity: isFailure ? 'WARNING' : 'INFO', resourceId: operationResult.matricula.id });
    if (willCreateEnrollmentFee) taxaSync = { success: false, error: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO' };
    if (willCreateSubscription) subscriptionSync = { success: false, error: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO', message: 'Matrícula criada. O financeiro está sincronizando automaticamente.', expectedWebhooks: isFailure ? [] : ['PAYMENT_CREATED', 'SUBSCRIPTION_CREATED'] };
  }

  return { kind: 'OK' as const, data: mapCreateMatriculaResultToDTO({ result: operationResult, taxaSync, subscriptionSync, notificationSync, operationalWarnings }) };
}
