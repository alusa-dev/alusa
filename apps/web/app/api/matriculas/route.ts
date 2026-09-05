import { syncEnrollmentNotifications } from '@/src/server/matriculas/enrollment-notifications.service';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma, StatusMatricula } from '@prisma/client';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  buscarMatriculaPorId,
  criarMatricula,
  listarMatriculas,
  MatriculaConflictError,
} from '@/src/server/matriculas/matricula.service';
import { processEnrollmentBillingOutboxEvent } from '@/src/server/matriculas/enrollment-billing-outbox.service';
import {
  createImmediateEnrollment,
  ImmediateEnrollmentCreationError,
} from '@/src/server/matriculas/create-immediate-enrollment.use-case';
import {
  createMatriculaInputDTOSchema,
  listMatriculasQueryDTOSchema,
} from '@/features/cadastro/matriculas/dtos';
import {
  mapCreateMatriculaDTOToServiceInput,
  mapCreateMatriculaResultToDTO,
  mapListMatriculasResultToDTO,
} from '@/features/cadastro/matriculas/mappers';
import {
  formatIsoDate,
  isDateOnlyBefore,
  resolveChargeableFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import {
  isSupportedAsaasBillingType,
  resolveWizardPaymentSelection,
} from '@/src/server/matriculas/payment-selection';
import {
  assertPlatformAccessForConta,
  isPlatformBillingCapacityError,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { EnrollmentContractModelSignatureFieldsError } from '@/src/server/contracts/create-pending-enrollment-contract.service';
import type {
  MatriculaOperationalWarningDTO,
  MatriculaAsaasSubscriptionSyncDTO,
  MatriculaAsaasTaxaSyncDTO,
} from '@/features/cadastro/matriculas/dtos';
import type { StagedEnrollmentFinancialResources } from '@alusa/finance';

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

const statusValues = new Set(Object.values(StatusMatricula));
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function normalizeMatriculaStatusFilters(values: string[]): StatusMatricula[] {
  return values.flatMap((value) => {
    if (value === 'CONCLUIDA') return [StatusMatricula.ENCERRADA];
    return statusValues.has(value as StatusMatricula) ? [value as StatusMatricula] : [];
  });
}

function parseCommitDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

async function rejectUnconfirmedEnrollment(input: {
  contaId: string;
  matriculaId: string;
  actorId: string;
  reason: string;
  requiresReconciliation: boolean;
}) {
  await prisma.$transaction(async (tx) => {
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
        where: {
          id: enrollment.contratoAtualId,
          contaId: input.contaId,
          status: { notIn: ['ASSINADO', 'CANCELADO'] },
        },
        data: { status: 'CANCELADO' },
      });
    }
    await tx.matriculaLog.create({
      data: {
        matriculaId: enrollment.id,
        actorId: input.actorId,
        action: 'MATRICULA_RECUSADA_FINANCEIRO_NAO_CONFIRMADO',
        metadata: {
          reason: input.reason,
          requiresReconciliation: input.requiresReconciliation,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * POST /api/matriculas — confirma o financeiro e cria a matrícula acadêmica.
 *
 * Matrículas individuais com cobrança usam uma saga síncrona compensável:
 * Asaas → commit local. Rematrículas continuam no fluxo futuro próprio.
 * Idempotência obrigatória via body.uiRequestId ou header X-Idempotency-Key.
 */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.getAll('status').flatMap((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const excludeStatus = url.searchParams.getAll('excludeStatus').flatMap((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );

    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const comboParam = url.searchParams.get('comboId');

    const parsedQuery = listMatriculasQueryDTOSchema.safeParse({
      contaId: url.searchParams.get('contaId') ?? undefined,
      alunoId: url.searchParams.get('alunoId') ?? undefined,
      planoId: url.searchParams.get('planoId') ?? undefined,
      turmaId: url.searchParams.get('turmaId') ?? undefined,
      comboId:
        comboParam === 'null'
          ? null
          : comboParam === null
            ? undefined
            : comboParam.trim() || undefined,
      status,
      excludeStatus,
      q: url.searchParams.get('q') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });

    if (!parsedQuery.success) {
      return jsonError(
        400,
        'PARAMETROS_INVALIDOS',
        parsedQuery.error.issues[0]?.message ?? 'ParÃ¢metros invÃ¡lidos.',
        parsedQuery.error.issues,
      );
    }

    const auth = await resolveAuthContext(parsedQuery.data.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada nÃ£o pertence ao usuÃ¡rio.');
    }
    if (!auth.sessionContaId) {
      return jsonError(
        403,
        'CONTA_SESSAO_OBRIGATORIA',
        'A conta ativa precisa estar vinculada à sessão do usuário.',
      );
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId Ã© obrigatÃ³rio');
    }
    if (
      !auth.user?.id ||
      !auth.user.role ||
      !allowedRoles.has(String(auth.user.role).toUpperCase())
    ) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        'UsuÃ¡rio nÃ£o tem permissÃ£o para acessar matrÃ­culas.',
      );
    }

    const validStatus = normalizeMatriculaStatusFilters(parsedQuery.data.status);
    const validExcludeStatus = normalizeMatriculaStatusFilters(parsedQuery.data.excludeStatus);

    const result = await listarMatriculas({
      contaId: auth.contaId,
      alunoId: parsedQuery.data.alunoId ?? undefined,
      planoId: parsedQuery.data.planoId ?? undefined,
      turmaId: parsedQuery.data.turmaId ?? undefined,
      comboId: parsedQuery.data.comboId === undefined ? undefined : parsedQuery.data.comboId,
      status: validStatus.length > 0 ? validStatus : undefined,
      excludeStatus: validExcludeStatus.length > 0 ? validExcludeStatus : undefined,
      search: parsedQuery.data.q ?? parsedQuery.data.search ?? undefined,
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
    });

    return NextResponse.json(mapListMatriculasResultToDTO(result));
  } catch (error) {
    console.error('Erro ao listar matrÃ­culas:', error);
    return jsonError(500, 'ERRO_LISTAR_MATRICULAS', (error as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsedBody = createMatriculaInputDTOSchema.safeParse(json);

    if (!parsedBody.success) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsedBody.error.issues[0]?.message ?? 'Payload invÃ¡lido',
        parsedBody.error.issues,
      );
    }

    const auth = await resolveAuthContext(parsedBody.data.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada nÃ£o pertence ao usuÃ¡rio.');
    }
    if (!auth.sessionContaId) {
      return jsonError(
        403,
        'CONTA_SESSAO_OBRIGATORIA',
        'A conta ativa precisa estar vinculada à sessão do usuário.',
      );
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId Ã© obrigatÃ³rio');
    }
    if (!auth.user?.id) {
      return jsonError(
        403,
        'USUARIO_NAO_AUTENTICADO',
        'UsuÃ¡rio nÃ£o autenticado ou ID nÃ£o encontrado.',
      );
    }
    if (!auth.user.role) {
      return jsonError(403, 'PAPEL_USUARIO_NAO_DEFINIDO', 'Papel do usuÃ¡rio nÃ£o estÃ¡ definido.');
    }
    if (!allowedRoles.has(String(auth.user.role).toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        `UsuÃ¡rio com papel "${auth.user.role}" nÃ£o tem permissÃ£o para criar matrÃ­culas.`,
      );
    }

    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    const paymentSelection = resolveWizardPaymentSelection({
      formaPagamento: parsedBody.data.formaPagamento,
      formaPagamentoTaxa: parsedBody.data.formaPagamentoTaxa,
    });

    if (paymentSelection.invalidFormaPagamento) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento da mensalidade Ã© invÃ¡lida.',
      );
    }

    if (paymentSelection.invalidFormaPagamentoTaxa) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de matrÃ­cula Ã© invÃ¡lida.',
      );
    }

    const idempotencyHeader = req.headers.get('x-idempotency-key')?.trim() || null;
    const commitIdempotencyKey = parsedBody.data.uiRequestId ?? idempotencyHeader ?? null;
    if (!commitIdempotencyKey) {
      return jsonError(
        400,
        'IDEMPOTENCY_KEY_OBRIGATORIA',
        'Informe uma chave de idempotÃªncia para confirmar a matrÃ­cula.',
      );
    }

    const previewExpiresAt = parseCommitDate(parsedBody.data.previewExpiresAt);
    if (Number.isNaN(previewExpiresAt.getTime())) {
      return jsonError(400, 'PREVIEW_EXPIRACAO_INVALIDA', 'ExpiraÃ§Ã£o do preview invÃ¡lida.');
    }
    if (previewExpiresAt <= new Date()) {
      return jsonError(
        409,
        'PREVIEW_EXPIRADO',
        'O preview da matrÃ­cula expirou. Gere um novo preview antes de confirmar.',
      );
    }

    let payload;
    try {
      payload = mapCreateMatriculaDTOToServiceInput({
        body: parsedBody.data,
        contaId: auth.contaId,
        createdById: auth.user.id,
        uiRequestId: commitIdempotencyKey,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'dataFimContrato Ã© obrigatÃ³rio.') {
        return jsonError(400, 'DATA_FIM_CONTRATO_OBRIGATORIA', message);
      }
      return jsonError(400, 'PAYLOAD_INVALIDO', message);
    }

    const willCreateSubscription = payload.criarCobranca === true;
    const willCreateEnrollmentFee =
      payload.gerarCobrancaTaxa === true && !payload.taxaIsenta && payload.taxaMatricula > 0;

    if (willCreateSubscription && !isSupportedAsaasBillingType(paymentSelection.billingType)) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento da mensalidade nÃ£o suporta cobranÃ§a no Asaas.',
      );
    }

    if (willCreateEnrollmentFee && !isSupportedAsaasBillingType(paymentSelection.billingTypeTaxa)) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de matrÃ­cula nÃ£o suporta cobranÃ§a no Asaas.',
      );
    }

    if (willCreateEnrollmentFee && !willCreateSubscription) {
      return jsonError(
        422,
        'ASSINATURA_OBRIGATORIA_PARA_MATRICULA_FINANCEIRA',
        'A taxa de matrícula só pode ser confirmada junto com a assinatura da mensalidade.',
      );
    }

    if (willCreateSubscription) {
      const previewNextDueDate = resolveChargeableFirstDueDate(
        payload.dataInicio,
        payload.vencimentoDia,
      );
      const previewNextDueDateIso = formatIsoDate(previewNextDueDate);
      const dataFimContratoIso = formatIsoDate(payload.dataFimContrato);

      if (isDateOnlyBefore(payload.dataFimContrato, previewNextDueDate)) {
        return jsonError(
          422,
          'DATA_FIM_INVALIDA',
          `A data de tÃ©rmino do contrato (${dataFimContratoIso}) precisa ser igual ou posterior ao primeiro vencimento (${previewNextDueDateIso}). Ajuste a data de tÃ©rmino ou o dia de vencimento.`,
        );
      }
    }

    const usesSeparateSubscription =
      !payload.billingStrategy || payload.billingStrategy.kind === 'SEPARATE';
    const result = willCreateSubscription && usesSeparateSubscription
      ? await createImmediateEnrollment(payload)
      : await criarMatricula(payload);

    let billingOutboxResult: Awaited<ReturnType<typeof processEnrollmentBillingOutboxEvent>> | null =
      null;
    const billingOutboxEventId =
      (result as { billingOutboxEventId?: string | null }).billingOutboxEventId ?? null;
    if (billingOutboxEventId) {
      billingOutboxResult = await processEnrollmentBillingOutboxEvent(billingOutboxEventId);
      const skippedButAlreadyConfirmed =
        billingOutboxResult.status === 'SKIPPED' &&
        Boolean(
          await prisma.matricula.findFirst({
            where: {
              id: result.matricula.id,
              contaId: auth.contaId,
              billingProvisionStatus: 'PROVISIONADO',
            },
            select: { id: true },
          }),
        );
      if (
        willCreateSubscription &&
        !usesSeparateSubscription &&
        billingOutboxResult.status !== 'PROCESSED' &&
        !skippedButAlreadyConfirmed
      ) {
        const requiresReconciliation =
          billingOutboxResult.status === 'REQUIRES_RECONCILIATION';
        const reason =
          billingOutboxResult.error ??
          (requiresReconciliation
            ? 'A alteração da assinatura existente teve resultado incerto.'
            : 'A alteração da assinatura existente não foi confirmada.');
        await rejectUnconfirmedEnrollment({
          contaId: auth.contaId,
          matriculaId: result.matricula.id,
          actorId: auth.user.id,
          reason,
          requiresReconciliation,
        });
        throw new ImmediateEnrollmentCreationError(
          requiresReconciliation
            ? 'UNIFICACAO_REQUER_RECONCILIACAO'
            : 'UNIFICACAO_FINANCEIRA_NAO_CONFIRMADA',
          requiresReconciliation
            ? 'A alteração financeira precisa de reconciliação. A matrícula não foi ativada e a vaga foi liberada.'
            : 'Não foi possível confirmar a alteração da assinatura. A matrícula não foi ativada.',
          requiresReconciliation,
        );
      }
      const refreshedMatricula = await buscarMatriculaPorId({
        id: result.matricula.id,
        contaId: auth.contaId,
      });
      if (refreshedMatricula) {
        result.matricula = refreshedMatricula;
        const refreshedTaxa = refreshedMatricula.cobrancas.find(
          (cobranca) => cobranca.tipo === 'TAXA_MATRICULA',
        );
        const refreshedMensalidade = refreshedMatricula.cobrancas.find(
          (cobranca) => cobranca.tipo === 'MENSALIDADE',
        );
        if (refreshedTaxa) {
          result.cobrancas.taxa = refreshedTaxa;
        }
        if (refreshedMensalidade) {
          result.cobrancas.mensalidade = refreshedMensalidade;
        }
      }
    }

    const notificationSync = await syncEnrollmentNotifications({
      contaId: auth.contaId,
      matriculaId: result.matricula.id,
      actorId: auth.user.id,
      correlationId: payload.uiRequestId,
      channels: payload.notificationChannels,
      configured: payload.notificationChannelsConfigured,
    });
    const operationalWarnings: MatriculaOperationalWarningDTO[] = [];
    const immediateSync =
      'immediateFinancialSync' in result
        ? (result as {
            immediateFinancialSync: {
              subscription: StagedEnrollmentFinancialResources['subscription'];
              enrollmentFee: StagedEnrollmentFinancialResources['enrollmentFee'];
            };
          }).immediateFinancialSync
        : null;
    let taxaSync: MatriculaAsaasTaxaSyncDTO | null = immediateSync?.enrollmentFee
      ? {
          success: true,
          asaasPaymentId: immediateSync.enrollmentFee.asaasPaymentId,
          invoiceUrl: immediateSync.enrollmentFee.invoiceUrl,
          bankSlipUrl: immediateSync.enrollmentFee.bankSlipUrl,
        }
      : null;
    let subscriptionSync: MatriculaAsaasSubscriptionSyncDTO | null = immediateSync
      ? {
          success: true,
          asaasSubscriptionId: immediateSync.subscription.asaasSubscriptionId,
          asaasPaymentId: immediateSync.subscription.firstPayment.asaasPaymentId,
          invoiceUrl: immediateSync.subscription.firstPayment.invoiceUrl,
          bankSlipUrl: immediateSync.subscription.firstPayment.bankSlipUrl,
          expectedWebhooks: [],
          message: 'Assinatura e primeira mensalidade confirmadas no Asaas.',
        }
      : null;

    const currentBillingProvisionStatus = String(
      result.matricula.billingProvisionStatus ?? 'NAO_APLICAVEL',
    );

    if (
      (willCreateEnrollmentFee || willCreateSubscription) &&
      ['PENDENTE', 'PROCESSANDO', 'PARCIAL', 'FALHO', 'RESULTADO_INCERTO'].includes(
        currentBillingProvisionStatus,
      )
    ) {
      const isFailure =
        currentBillingProvisionStatus === 'FALHO' ||
        currentBillingProvisionStatus === 'RESULTADO_INCERTO' ||
        billingOutboxResult?.status === 'FAILED' ||
        billingOutboxResult?.status === 'REQUIRES_RECONCILIATION';
      operationalWarnings.push({
        type: 'FINANCIAL_PROVISION_PENDING',
        code: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO',
        message: isFailure
          ? 'Matrícula salva. O financeiro precisa de conferência antes de continuar.'
          : 'Matrícula salva. O financeiro está sincronizando automaticamente.',
        severity: isFailure ? 'WARNING' : 'INFO',
        resourceId: result.matricula.id,
      });

      if (willCreateEnrollmentFee) {
        taxaSync = {
          success: false,
          error: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO',
        };
      }

      if (willCreateSubscription) {
        subscriptionSync = {
          success: false,
          error: isFailure ? 'FINANCEIRO_REQUER_ATENCAO' : 'FINANCEIRO_SINCRONIZANDO',
          message:
            'Matrícula criada. O financeiro está sincronizando automaticamente.',
          expectedWebhooks: isFailure ? [] : ['PAYMENT_CREATED', 'SUBSCRIPTION_CREATED'],
        };
      }
    }

    return NextResponse.json(
      mapCreateMatriculaResultToDTO({
        result,
        taxaSync,
        subscriptionSync,
        notificationSync,
        operationalWarnings,
      }),
    );
  } catch (error) {
    console.error('Erro ao criar matrÃ­cula:', error);
    if (error instanceof ImmediateEnrollmentCreationError) {
      return jsonError(
        error.requiresReconciliation ? 503 : 422,
        error.code,
        error.message,
        {
          requiresReconciliation: error.requiresReconciliation,
          ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
        },
      );
    }
    if (error instanceof MatriculaConflictError) {
      return jsonError(409, error.code, error.message);
    }
    if (error instanceof EnrollmentContractModelSignatureFieldsError) {
      return jsonError(422, 'MODELO_SEM_CAMPOS_ASSINATURA', error.message);
    }
    if (error instanceof Error && error.message === 'PREVIEW_EXPIRADO') {
      return jsonError(
        409,
        'PREVIEW_EXPIRADO',
        'O preview da matrícula expirou. Gere um novo preview antes de confirmar.',
      );
    }
    if (error instanceof Error && error.message === 'PREVIEW_DESATUALIZADO') {
      return jsonError(
        409,
        'PREVIEW_DESATUALIZADO',
        'O preview da matrícula mudou. Revise os valores e confirme novamente.',
      );
    }
    if (error instanceof Error && error.message.startsWith('PREVIEW_INCOMPATIVEL:')) {
      const [, code, ...messageParts] = error.message.split(':');
      return jsonError(
        409,
        'PREVIEW_INCOMPATIVEL',
        messageParts.join(':') || 'A composição financeira da matrícula não está compatível.',
        { code },
      );
    }
    if (isPlatformBillingCapacityError(error)) {
      return jsonError(422, error.code, error.message, error.details);
    }
    if (
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return jsonError(
        500,
        'ERRO_INTERNO_MATRICULA',
        'Falha interna ao preparar a matrÃ­cula. Atualize o servidor e tente novamente.',
      );
    }
    return jsonError(500, 'ERRO_CRIAR_MATRICULA', (error as Error).message);
  }
}
