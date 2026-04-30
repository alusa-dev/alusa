import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { KycNotApprovedError, updateSubscription } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import { updateMatriculaValueInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionValueUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { deriveLocalAssinaturaSnapshot } from '@/src/server/matriculas/subscription-snapshot';

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
 * PUT /api/matriculas/[id]/valor
 * Atualiza o valor da mensalidade da assinatura no Asaas
 * 
 * @see https://docs.asaas.com/docs/criando-uma-assinatura - POST /v3/subscriptions/{id}
 * 
 * Body:
 * - value: number (novo valor da mensalidade)
 * - updatePendingPayments: boolean (se true, atualiza cobranças pendentes também)
 */
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionUser = await resolveSessionUser();
    const json = await req.json().catch(() => null);
    const parsedBody = updateMatriculaValueInputDTOSchema.safeParse(json);
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

    const matriculaId = ctx.params.id;
    const { value, updatePendingPayments } = parsedBody.data;

    // Buscar matrícula
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: contaCtx.contaId },
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        planoId: true,
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

    if (localSnapshot?.value === value) {
      return NextResponse.json(
        mapMatriculaSubscriptionValueUpdateResultToDTO({
          subscriptionId: matricula.asaasSubscriptionId,
          value,
          updatePendingPayments,
          message: 'A assinatura já está configurada com este valor.',
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    let asaasResponse;
    try {
      asaasResponse = await updateSubscription(matricula.asaasSubscriptionId, {
        value,
        updatePendingPayments,
      }, {
        contaId: contaCtx.contaId,
      });
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
        action: 'MATRICULA_SUBSCRIPTION_VALUE_UPDATED',
        metadata: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          previousValue: localSnapshot?.value ?? null,
          nextValue: value,
          updatePendingPayments,
        },
      },
    });

    console.log('[ASAAS_SYNC] Valor da assinatura atualizado com sucesso no Asaas:', {
      subscriptionId: asaasResponse.id,
      newValue: asaasResponse.value,
    });

    // Atualizar valor no banco local se necessário (ex: campo de valor personalizado)
    // Nota: O valor da mensalidade vem do Plano, mas podemos armazenar um override

    return NextResponse.json(
      mapMatriculaSubscriptionValueUpdateResultToDTO({
        subscriptionId: asaasResponse.id,
        value: asaasResponse.value,
        updatePendingPayments,
        message: updatePendingPayments
          ? 'Valor da mensalidade atualizado com sucesso (incluindo cobranças pendentes)'
          : 'Valor da mensalidade atualizado com sucesso (apenas futuras cobranças)',
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[ASAAS_SYNC] Erro ao atualizar valor:', error);
    if (error instanceof KycNotApprovedError) {
      return jsonError(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }
    return jsonError(500, 'ERRO_ATUALIZAR_VALOR', (error as Error).message);
  }
}
