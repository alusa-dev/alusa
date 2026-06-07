import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { KycNotApprovedError, updateSubscription } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { updateMatriculaBillingTypeInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionBillingTypeUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { deriveLocalAssinaturaSnapshot } from '@/src/server/matriculas/subscription-snapshot';
import { mapBillingTypeToFormaPagamento } from '@/src/server/matriculas/recurring-billing';
import { alignLocalPendingEnrollmentCharges } from '@/src/server/matriculas/enrollment-finance-consistency.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

type SessionUser = {
  id?: string | null;
  contaId?: string | null;
};

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionUser = (session as { user?: SessionUser } | null)?.user ?? null;
  const sessionContaId = sessionUser?.contaId || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true };
  }
  return { contaId: requested || sessionContaId, mismatch: false };
}

async function resolveSessionUser() {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * PUT /api/matriculas/[id]/forma-pagamento
 * Atualiza a forma de pagamento da assinatura no Asaas
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const sessionUser = await resolveSessionUser();
    const json = await req.json().catch(() => null);
    const parsedBody = updateMatriculaBillingTypeInputDTOSchema.safeParse(json);
    if (!parsedBody.success) {
      return jsonError(
        400,
        'PAYLOAD_INVALIDO',
        parsedBody.error.issues[0]?.message ?? 'Payload inválido',
        parsedBody.error.issues,
      );
    }

    const contaCtx = await resolveContaId(parsedBody.data.contaId ?? null);
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }
    if (!contaCtx.contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }

    const matriculaId = ctxParams.id;
    const { billingType } = parsedBody.data;

    // Buscar matrícula
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: contaCtx.contaId },
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        formaPagamento: true,
        formaPagamentoTaxa: true,
        updatedAt: true,
        plano: { select: { valor: true } },
        combo: { select: { valor: true } },
        cobrancas: {
          select: {
            tipo: true,
            status: true,
            formaPagamento: true,
            valor: true,
            vencimento: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    if (!matricula.asaasSubscriptionId) {
      return jsonError(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
    }

    const localSubscription = await prisma.subscription.findFirst({
      where: {
        contaId: contaCtx.contaId,
        matriculaId: matricula.id,
      },
      select: {
        status: true,
        updatedAt: true,
      },
    });
    const localSnapshot = deriveLocalAssinaturaSnapshot(
      matricula as unknown as Record<string, unknown>,
      localSubscription,
    );

    if (localSnapshot?.deleted || localSnapshot?.status === 'EXPIRED') {
      return jsonError(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
    }

    if (localSnapshot?.billingType === billingType) {
      return NextResponse.json(
        mapMatriculaSubscriptionBillingTypeUpdateResultToDTO({
          billingType,
          message: 'A assinatura já está configurada com esta forma de pagamento.',
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    try {
      await updateSubscription(
        matricula.asaasSubscriptionId,
        {
          billingType: billingType as 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED',
          updatePendingPayments: true,
        },
        {
          contaId: contaCtx.contaId,
        },
      );
    } catch (error) {
      const classified = classifyAsaasSubscriptionMutationError(error);
      if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
        return jsonError(
          409,
          'ASSINATURA_NAO_EDITAVEL',
          classified.providerMessage ?? 'O vínculo recorrente não pode ser atualizado no momento.',
        );
      }
      if (classified.kind === 'unauthorized') {
        return jsonError(
          502,
          'FINANCEIRO_AUTENTICACAO_INVALIDA',
          classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
        );
      }
      throw error;
    }

    await prisma.matriculaLog.create({
      data: {
        matriculaId,
        actorId: sessionUser?.id ?? 'system',
        action: 'MATRICULA_SUBSCRIPTION_BILLING_TYPE_UPDATED',
        metadata: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          previousBillingType: localSnapshot?.billingType ?? null,
          nextBillingType: billingType,
          updatePendingPayments: true,
        },
      },
    });

    const nextFormaPagamento = mapBillingTypeToFormaPagamento(billingType);
    let localAlignment = null;
    if (nextFormaPagamento) {
      await prisma.matricula.update({
        where: { id: matriculaId },
        data: { formaPagamento: nextFormaPagamento },
      });
      localAlignment = await alignLocalPendingEnrollmentCharges({
        db: prisma,
        matriculaId,
        contaId: contaCtx.contaId,
        billingType: nextFormaPagamento,
        chargeBillingType: billingType,
      });
    }

    return NextResponse.json(
      {
        ...mapMatriculaSubscriptionBillingTypeUpdateResultToDTO({
          billingType,
          message: 'Forma de pagamento atualizada com sucesso para os próximos ciclos e para as pendências ainda editáveis.',
        }),
        asyncSync: {
          provider: 'ASAAS',
          fields: ['billingType', 'updatePendingPayments'],
          localAlignment,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[ASAAS_SYNC] Erro ao atualizar forma de pagamento:', error);
    if (error instanceof KycNotApprovedError) {
      return jsonError(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }
    return jsonError(500, 'ERRO_ATUALIZAR_FORMA_PAGAMENTO', (error as Error).message);
  }
}
