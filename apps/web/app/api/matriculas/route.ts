import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  Prisma,
  FormaPagamento,
  PeriodicidadePlano,
  StatusMatricula,
} from '@prisma/client';
import { authOptions } from '@/lib/auth-options';
import { criarMatricula, listarMatriculas, MatriculaConflictError } from '@/src/server/matriculas/matricula.service';
import { prisma } from '@/src/prisma';
import {
  createCharge,
  createSubscription,
  ensureCustomer,
  getAsaasPaymentDetails,
  syncPaymentStateFromAsaas,
  syncCustomerNotificationChannels,
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
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveFirstDueDate,
} from '@/src/server/matriculas/recurring-billing';
import { syncInitialSubscriptionPaymentFromAsaas } from '@/src/server/matriculas/subscription-payment-materialization';

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams
      .getAll('status')
      .flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
    const excludeStatus = url.searchParams
      .getAll('excludeStatus')
      .flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const comboParam = url.searchParams.get('comboId');

    const parsedQuery = listMatriculasQueryDTOSchema.safeParse({
      contaId: url.searchParams.get('contaId') ?? undefined,
      alunoId: url.searchParams.get('alunoId') ?? undefined,
      planoId: url.searchParams.get('planoId') ?? undefined,
      turmaId: url.searchParams.get('turmaId') ?? undefined,
      comboId:
        comboParam === 'null' ? null : comboParam === null ? undefined : comboParam.trim() || undefined,
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

    const validStatus = parsedQuery.data.status.filter(
      (value): value is StatusMatricula => statusValues.has(value as StatusMatricula),
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

    let payload;
    try {
      payload = mapCreateMatriculaDTOToServiceInput({
        body: parsedBody.data,
        contaId: auth.contaId,
        createdById: auth.user.id,
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'dataFimContrato é obrigatório.') {
        return jsonError(400, 'DATA_FIM_CONTRATO_OBRIGATORIA', message);
      }
      return jsonError(400, 'PAYLOAD_INVALIDO', message);
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
          const syncResult = await syncCustomerNotificationChannels(
            auth.contaId,
            ensuredCustomer.data.customerId,
            {
              email: parsedBody.data.notificationChannels.includes('EMAIL'),
              sms: parsedBody.data.notificationChannels.includes('SMS'),
              whatsapp: parsedBody.data.notificationChannels.includes('WHATSAPP'),
            },
          );

          if (syncResult.warnings.length > 0) {
            console.warn('[API Matrícula] Avisos ao sincronizar notificações do customer', {
              matriculaId: result.matricula.id,
              customerId: ensuredCustomer.data.customerId,
              warnings: syncResult.warnings,
            });
          }
        } else {
          console.warn('[API Matrícula] Não foi possível garantir o customer para sincronizar notificações', {
            matriculaId: result.matricula.id,
            error: ensuredCustomer.error,
          });
        }
      } catch (error) {
        console.error('[API Matrícula] Falha não crítica ao sincronizar notificações escolhidas no wizard', {
          matriculaId: result.matricula.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let taxaSync:
      | {
          success: boolean;
          error?: string;
          asaasPaymentId?: string;
          invoiceUrl?: string | null;
          bankSlipUrl?: string | null;
        }
      | null = null;
    let subscriptionSync:
      | {
          success: boolean;
          error?: string;
          asaasSubscriptionId?: string | null;
          asaasPaymentId?: string | null;
          invoiceUrl?: string | null;
          bankSlipUrl?: string | null;
          expectedWebhooks?: string[];
          message?: string;
        }
      | null = null;

    const requiresTaxConfirmation =
      payload.gerarCobrancaTaxa &&
      !payload.taxaIsenta &&
      Number(result.preco.taxa ?? 0) > 0;

    if (requiresTaxConfirmation && !result.cobrancas.taxa) {
      taxaSync = { success: false, error: 'COBRANCA_TAXA_NAO_ENCONTRADA' };
    }

    if (result.cobrancas.taxa && requiresTaxConfirmation) {
      const cobrancaTaxa = result.cobrancas.taxa;

      if (cobrancaTaxa.formaPagamento !== FormaPagamento.INDEFINIDO) {
        const chargeResult = await createCharge({
          contaId: auth.contaId,
          cobrancaId: cobrancaTaxa.id,
          actor: { type: 'USER', id: auth.user.id },
        });

        if (chargeResult.success) {
          const asaasPaymentId = chargeResult.data.asaasPaymentId ?? null;

          if (asaasPaymentId && result.cobrancas.taxa) {
            result.cobrancas.taxa = {
              ...result.cobrancas.taxa,
              asaasPaymentId,
            };
          }

          if (!asaasPaymentId) {
            taxaSync = { success: false, error: 'ASAAS_PAYMENT_ID_NAO_RETORNADO' };
          } else {
            try {
              const syncResult = await syncPaymentStateFromAsaas({
                contaId: auth.contaId,
                asaasPaymentId,
                eventName: 'PAYMENT_CREATED',
              });

              taxaSync = syncResult.success
                ? { success: true, asaasPaymentId }
                : { success: false, error: syncResult.error, asaasPaymentId };
            } catch (err) {
              taxaSync = {
                success: false,
                error: err instanceof Error ? err.message : 'ERRO_SINCRONIZAR_TAXA_ASAAS',
                asaasPaymentId,
              };
            }

            try {
              const details = await getAsaasPaymentDetails({
                contaId: auth.contaId,
                paymentId: asaasPaymentId,
                includePixQrCode: false,
              });

              taxaSync = {
                ...(taxaSync ?? { success: false, asaasPaymentId }),
                invoiceUrl: details.payment.invoiceUrl ?? null,
                bankSlipUrl: details.payment.bankSlipUrl ?? null,
              };
            } catch (err) {
              console.warn('[API Matrícula] Falha ao obter invoiceUrl do Asaas para taxa', {
                cobrancaId: cobrancaTaxa.id,
                asaasPaymentId,
                message: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } else {
          taxaSync = { success: false, error: chargeResult.error };
        }
      } else {
        taxaSync = { success: false, error: 'FORMA_PAGAMENTO_INVALIDA' };
      }
    }

    const shouldCreateSubscription = payload.criarCobranca && result.preco.planoLiquido > 0;
    const subscriptionBlockedByTax = requiresTaxConfirmation && !taxaSync?.success;

    if (shouldCreateSubscription && subscriptionBlockedByTax) {
      subscriptionSync = {
        success: false,
        error: 'TAXA_ASAAS_NAO_CONFIRMADA',
        message:
          'A mensalidade não foi criada porque a taxa de matrícula ainda não foi confirmada pelo Asaas.',
      };
    }

    if (shouldCreateSubscription && !subscriptionBlockedByTax) {
      const recurringContext = await prisma.matricula.findUnique({
        where: { id: result.matricula.id },
        select: {
          id: true,
          dataInicio: true,
          dataFimContrato: true,
          vencimentoDia: true,
          formaPagamento: true,
          descontoAntecipado: true,
          prazoDesconto: true,
          descontoTipo: true,
          jurosMensal: true,
          multaPercentual: true,
          multaTipo: true,
          plano: { select: { id: true, nome: true, periodicidade: true } },
          combo: { select: { id: true, nome: true, periodicidade: true } },
        },
      });

      if (!recurringContext) {
        subscriptionSync = { success: false, error: 'MATRICULA_NAO_ENCONTRADA' };
      } else {
        const billingType = mapFormaPagamentoToBillingType(recurringContext.formaPagamento);

        if (!billingType) {
          subscriptionSync = { success: false, error: 'FORMA_PAGAMENTO_INVALIDA' };
        } else {
          const planoOuCombo = recurringContext.combo ?? recurringContext.plano;
          const periodicidade = (planoOuCombo?.periodicidade ?? PeriodicidadePlano.MENSAL) as PeriodicidadePlano;
          const nextDueDateObj = resolveFirstDueDate(recurringContext.dataInicio, recurringContext.vencimentoDia);
          const nextDueDate = formatIsoDate(nextDueDateObj);
          const endDate =
            recurringContext.dataFimContrato >= nextDueDateObj
              ? formatIsoDate(recurringContext.dataFimContrato)
              : undefined;
          const discountValue = recurringContext.descontoAntecipado
            ? Number(recurringContext.descontoAntecipado)
            : 0;
          const interestValue = recurringContext.jurosMensal ? Number(recurringContext.jurosMensal) : 0;
          const fineValue = recurringContext.multaPercentual
            ? Number(recurringContext.multaPercentual)
            : 0;

          const subscriptionResult = await createSubscription({
            contaId: auth.contaId,
            contratoId: null,
            matriculaId: result.matricula.id,
            value: result.preco.planoLiquido,
            nextDueDate,
            billingType,
            cycle: mapPeriodicidadeToCycle(periodicidade),
            description: planoOuCombo?.nome ? `Mensalidade - ${planoOuCombo.nome}` : 'Mensalidade',
            endDate,
            discount:
              discountValue > 0
                ? {
                    value: discountValue,
                    dueDateLimitDays: recurringContext.prazoDesconto ?? 0,
                    type: (recurringContext.descontoTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
                  }
                : undefined,
            interest: interestValue > 0 ? { value: interestValue } : undefined,
            fine:
              fineValue > 0
                ? {
                    value: fineValue,
                    type: (recurringContext.multaTipo ?? 'PERCENTAGE') as 'FIXED' | 'PERCENTAGE',
                  }
                : undefined,
            actor: { type: 'USER', id: auth.user.id },
          });

          if (subscriptionResult.success) {
            if (!subscriptionResult.data.asaasSubscriptionId) {
              subscriptionSync = { success: false, error: 'ASSINATURA_SEM_ID_ASAAS' };
            } else {
              result.matricula = {
                ...result.matricula,
                asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId,
              };
              const initialPaymentSync = await syncInitialSubscriptionPaymentFromAsaas({
                contaId: auth.contaId,
                asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId,
                targetDueDate: nextDueDateObj,
                intent: 'RECONCILIATION',
              });

              if (initialPaymentSync.localCharge) {
                result.cobrancas.mensalidade = initialPaymentSync.localCharge;
              }

              subscriptionSync = {
                success: initialPaymentSync.processed || !initialPaymentSync.found,
                asaasSubscriptionId: subscriptionResult.data.asaasSubscriptionId ?? null,
                asaasPaymentId: initialPaymentSync.payment?.id ?? null,
                invoiceUrl: initialPaymentSync.payment?.invoiceUrl ?? null,
                bankSlipUrl: initialPaymentSync.payment?.bankSlipUrl ?? null,
                expectedWebhooks:
                  initialPaymentSync.processed || initialPaymentSync.found
                    ? []
                    : ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
                message: initialPaymentSync.processed
                  ? 'A assinatura e o primeiro ciclo foram sincronizados diretamente da API oficial do Asaas.'
                  : initialPaymentSync.found
                    ? 'A assinatura foi criada no Asaas, mas o primeiro ciclo oficial não pôde ser materializado localmente neste momento.'
                    : 'A assinatura foi criada no Asaas. O primeiro ciclo será confirmado pelo webhook oficial assim que estiver disponível.',
                error: initialPaymentSync.processed || !initialPaymentSync.found
                  ? undefined
                  : initialPaymentSync.error ?? 'ERRO_SINCRONIZAR_PRIMEIRO_CICLO',
              };
            }
          } else {
            subscriptionSync = { success: false, error: subscriptionResult.error };
          }
        }
      }
    }

    return NextResponse.json(
      mapCreateMatriculaResultToDTO({
        result,
        taxaSync,
        subscriptionSync,
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
