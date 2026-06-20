import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma, StatusMatricula } from '@prisma/client';
import { authOptions } from '@/lib/auth-options';
import {
  criarMatricula,
  listarMatriculas,
  MatriculaConflictError,
} from '@/src/server/matriculas/matricula.service';
import { prisma } from '@/src/prisma';
import {
  ensureCustomer,
  syncCustomerNotificationsForUserSelection,
  channelPreferencesFromWizardSelection,
} from '@alusa/finance';
import { createEnrollmentCreatedNotification } from '@alusa/lib';
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
  resolveChargeableFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import {
  isSupportedAsaasBillingType,
  resolveWizardPaymentSelection,
} from '@/src/server/matriculas/payment-selection';
import { provisionIndividualEnrollmentBilling } from '@/src/server/matriculas/enrollment-billing.orchestrator';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import type {
  MatriculaAsaasSubscriptionSyncDTO,
  MatriculaAsaasTaxaSyncDTO,
} from '@/features/cadastro/matriculas/dtos';

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

/**
 * POST /api/matriculas — cria matrícula acadêmica e provisiona cobrança (taxa + assinatura).
 *
 * Fluxo: criarMatricula (DB) → provisionIndividualEnrollmentBilling (Asaas outbound).
 * Idempotência opcional via body.uiRequestId ou header X-Idempotency-Key.
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
        parsedQuery.error.issues[0]?.message ?? 'Parâmetros inválidos.',
        parsedQuery.error.issues,
      );
    }

    const auth = await resolveAuthContext(parsedQuery.data.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (
      !auth.user?.id ||
      !auth.user.role ||
      !allowedRoles.has(String(auth.user.role).toUpperCase())
    ) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        'Usuário não tem permissão para acessar matrículas.',
      );
    }

    const validStatus = parsedQuery.data.status.filter((value): value is StatusMatricula =>
      statusValues.has(value as StatusMatricula),
    );
    const validExcludeStatus = parsedQuery.data.excludeStatus.filter(
      (value): value is StatusMatricula => statusValues.has(value as StatusMatricula),
    );

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
    console.error('Erro ao listar matrículas:', error);
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
        parsedBody.error.issues[0]?.message ?? 'Payload inválido',
        parsedBody.error.issues,
      );
    }

    const auth = await resolveAuthContext(parsedBody.data.contaId ?? null);

    if (auth.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!auth.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (!auth.user?.id) {
      return jsonError(
        403,
        'USUARIO_NAO_AUTENTICADO',
        'Usuário não autenticado ou ID não encontrado.',
      );
    }
    if (!auth.user.role) {
      return jsonError(403, 'PAPEL_USUARIO_NAO_DEFINIDO', 'Papel do usuário não está definido.');
    }
    if (!allowedRoles.has(String(auth.user.role).toUpperCase())) {
      return jsonError(
        403,
        'PERMISSAO_NEGADA',
        `Usuário com papel "${auth.user.role}" não tem permissão para criar matrículas.`,
      );
    }

    const paymentSelection = resolveWizardPaymentSelection({
      formaPagamento: parsedBody.data.formaPagamento,
      formaPagamentoTaxa: parsedBody.data.formaPagamentoTaxa,
    });

    if (paymentSelection.invalidFormaPagamento) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_INVALIDA',
        'Forma de pagamento da mensalidade é inválida.',
      );
    }

    if (paymentSelection.invalidFormaPagamentoTaxa) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de matrícula é inválida.',
      );
    }

    let payload;
    try {
      const idempotencyHeader = req.headers.get('x-idempotency-key')?.trim() || null;
      payload = mapCreateMatriculaDTOToServiceInput({
        body: parsedBody.data,
        contaId: auth.contaId,
        createdById: auth.user.id,
        uiRequestId: parsedBody.data.uiRequestId ?? idempotencyHeader ?? undefined,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'dataFimContrato é obrigatório.') {
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
        'Forma de pagamento da mensalidade não suporta cobrança no Asaas.',
      );
    }

    if (willCreateEnrollmentFee && !isSupportedAsaasBillingType(paymentSelection.billingTypeTaxa)) {
      return jsonError(
        422,
        'FORMA_PAGAMENTO_TAXA_INVALIDA',
        'Forma de pagamento da taxa de matrícula não suporta cobrança no Asaas.',
      );
    }

    if (willCreateSubscription) {
      const previewNextDueDate = resolveChargeableFirstDueDate(
        payload.dataInicio,
        payload.vencimentoDia,
      );
      const previewNextDueDateIso = formatIsoDate(previewNextDueDate);
      const dataFimContratoIso = formatIsoDate(payload.dataFimContrato);

      if (previewNextDueDateIso > dataFimContratoIso) {
        return jsonError(
          422,
          'DATA_FIM_INVALIDA',
          `A data de término do contrato (${dataFimContratoIso}) precisa ser igual ou posterior ao primeiro vencimento (${previewNextDueDateIso}). Ajuste a data de término ou o dia de vencimento.`,
        );
      }
    }

    if (willCreateSubscription || willCreateEnrollmentFee) {
      const gate = await guardFinancialAccountOr412(auth.contaId);
      if (!gate.ok) return gate.response;
    }

    const result = await criarMatricula(payload);

    void createEnrollmentCreatedNotification({
      contaId: auth.contaId,
      matriculaId: result.matricula.id,
      actorUserId: auth.user.id,
    }).catch((error) => {
      console.error('[API Matrícula] Falha não crítica ao criar notificação interna de matrícula', {
        matriculaId: result.matricula.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });

    let notificationSync: {
      applied: { email: boolean; sms: boolean; whatsapp: boolean };
      warnings: Array<{
        notificationId: string;
        event: string;
        channel: string;
        code: string;
        message: string;
      }>;
    } | null = null;

    if (parsedBody.data.notificationChannelsConfigured) {
      try {
        const payer = payload.responsavelFinanceiroId
          ? { type: 'RESPONSAVEL' as const, id: payload.responsavelFinanceiroId }
          : { type: 'ALUNO' as const, id: payload.alunoId };

        const ensuredCustomer = await ensureCustomer({
          contaId: auth.contaId,
          payer,
        });

        if (ensuredCustomer.success) {
          const channelPrefs = channelPreferencesFromWizardSelection(
            parsedBody.data.notificationChannels,
          );
          const syncResult = await syncCustomerNotificationsForUserSelection(
            auth.contaId,
            ensuredCustomer.data.customerId,
            channelPrefs,
          );

          notificationSync = {
            applied: syncResult.applied,
            warnings: syncResult.warnings,
          };

          if (syncResult.warnings.length > 0) {
            console.warn('[API Matrícula] Avisos ao sincronizar notificações do customer', {
              matriculaId: result.matricula.id,
              customerId: ensuredCustomer.data.customerId,
              warnings: syncResult.warnings,
            });
          }
        } else {
          console.warn(
            '[API Matrícula] Não foi possível garantir o customer para sincronizar notificações',
            {
              matriculaId: result.matricula.id,
              error: ensuredCustomer.error,
            },
          );
        }
      } catch (error) {
        console.error(
          '[API Matrícula] Falha não crítica ao sincronizar notificações escolhidas no wizard',
          {
            matriculaId: result.matricula.id,
            message: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    let taxaSync: MatriculaAsaasTaxaSyncDTO | null = null;
    let subscriptionSync: MatriculaAsaasSubscriptionSyncDTO | null = null;

    const billingOutcome = await provisionIndividualEnrollmentBilling({
      contaId: auth.contaId,
      actorUserId: auth.user.id,
      matriculaId: result.matricula.id,
      payload: {
        criarCobranca: payload.criarCobranca,
        gerarCobrancaTaxa: payload.gerarCobrancaTaxa,
        taxaIsenta: payload.taxaIsenta,
      },
      preco: result.preco,
      cobrancas: {
        taxa: result.cobrancas.taxa
          ? {
              id: result.cobrancas.taxa.id,
              formaPagamento: result.cobrancas.taxa.formaPagamento,
              asaasPaymentId: result.cobrancas.taxa.asaasPaymentId,
            }
          : null,
        mensalidade: null,
      },
      matriculaSnapshot: {
        asaasSubscriptionId: result.matricula.asaasSubscriptionId,
      },
    });

    taxaSync = billingOutcome.taxaSync;
    subscriptionSync = billingOutcome.subscriptionSync;

    if (billingOutcome.cobrancas.taxa?.asaasPaymentId && result.cobrancas.taxa) {
      result.cobrancas.taxa = {
        ...result.cobrancas.taxa,
        asaasPaymentId: billingOutcome.cobrancas.taxa.asaasPaymentId,
      };
    }

    if (billingOutcome.cobrancas.mensalidade?.id) {
      const mensalidade = await prisma.cobranca.findFirst({
        where: { id: billingOutcome.cobrancas.mensalidade.id, contaId: auth.contaId },
      });
      result.cobrancas.mensalidade = mensalidade;
    }

    if (billingOutcome.matriculaSnapshot.asaasSubscriptionId) {
      result.matricula = {
        ...result.matricula,
        asaasSubscriptionId: billingOutcome.matriculaSnapshot.asaasSubscriptionId,
      };
    }

    return NextResponse.json(
      mapCreateMatriculaResultToDTO({
        result,
        taxaSync,
        subscriptionSync,
        notificationSync,
      }),
    );
  } catch (error) {
    console.error('Erro ao criar matrícula:', error);
    if (error instanceof MatriculaConflictError) {
      return jsonError(409, error.code, error.message);
    }
    if (
      error instanceof Prisma.PrismaClientValidationError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return jsonError(
        500,
        'ERRO_INTERNO_MATRICULA',
        'Falha interna ao preparar a matrícula. Atualize o servidor e tente novamente.',
      );
    }
    return jsonError(500, 'ERRO_CRIAR_MATRICULA', (error as Error).message);
  }
}
