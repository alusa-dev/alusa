import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSubscription, updateSubscription } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { editarMatricula, MatriculaConflictError } from '@/src/server/matriculas/matricula.service';
import { editMatriculaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapEditMatriculaResultToDTO } from '@/features/cadastro/matriculas/mappers';
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
  const sessionUserId = sessionUser?.id || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId, sessionUserId };
  }
  return {
    contaId: requested || sessionContaId,
    mismatch: false,
    sessionContaId,
    sessionUserId,
  };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const json = await req.json().catch(() => null);
    const parsedBody = editMatriculaInputDTOSchema.safeParse(json);
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
    if (!contaCtx.contaId || !contaCtx.sessionUserId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const currentMatricula = await prisma.matricula.findFirst({
      where: { id: ctxParams.id, aluno: { contaId: contaCtx.contaId } },
      select: {
        id: true,
        planoId: true,
        asaasSubscriptionId: true,
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

    if (!currentMatricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    let financialMetadata: Record<string, unknown> | undefined;
    if (
      parsedBody.data.planoId &&
      parsedBody.data.planoId !== currentMatricula.planoId &&
      currentMatricula.asaasSubscriptionId
    ) {
      const nextPlano = await prisma.plano.findFirst({
        where: { id: parsedBody.data.planoId, contaId: contaCtx.contaId },
        select: { id: true, nome: true, valor: true },
      });

      if (!nextPlano) {
        return jsonError(404, 'PLANO_NAO_ENCONTRADO', 'Plano não encontrado para a conta informada.');
      }

      const localSubscription = await prisma.subscription.findFirst({
        where: {
          contaId: contaCtx.contaId,
          matriculaId: currentMatricula.id,
        },
        select: {
          status: true,
          updatedAt: true,
        },
      });
      const localSnapshot = deriveLocalAssinaturaSnapshot(
        currentMatricula as unknown as Record<string, unknown>,
        localSubscription,
      );

      let remoteSubscription: Awaited<ReturnType<typeof getSubscription>>;

      try {
        remoteSubscription = await getSubscription(currentMatricula.asaasSubscriptionId, {
          contaId: contaCtx.contaId,
        });
      } catch (error) {
        const classified = classifyAsaasSubscriptionMutationError(error);
        if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
          return jsonError(
            409,
            'ASSINATURA_NAO_EDITAVEL',
            classified.providerMessage ??
              'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
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

      if (remoteSubscription.deleted || remoteSubscription.status === 'EXPIRED') {
        return jsonError(
          409,
          'ASSINATURA_NAO_EDITAVEL',
          'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
        );
      }

      const previousValue =
        typeof remoteSubscription.value === 'number' ? remoteSubscription.value : localSnapshot?.value ?? null;

      if (previousValue !== Number(nextPlano.valor)) {
        try {
          await updateSubscription(
            currentMatricula.asaasSubscriptionId,
            {
              value: Number(nextPlano.valor),
              updatePendingPayments: true,
            },
            { contaId: contaCtx.contaId },
          );
        } catch (error) {
          const classified = classifyAsaasSubscriptionMutationError(error);
          if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
            return jsonError(
              409,
              'ASSINATURA_NAO_EDITAVEL',
              classified.providerMessage ??
                'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.',
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
      }

      financialMetadata = {
        subscriptionSync: {
          kind: 'PLAN_VALUE_UPDATED',
          asaasSubscriptionId: currentMatricula.asaasSubscriptionId,
          previousValue,
          nextValue: Number(nextPlano.valor),
          previousPlanoId: currentMatricula.planoId,
          nextPlanoId: nextPlano.id,
        },
      };
    }

    const matricula = await editarMatricula({
      matriculaId: ctxParams.id,
      contaId: contaCtx.contaId,
      createdById: contaCtx.sessionUserId,
      turmaId: parsedBody.data.turmaId ?? undefined,
      comboId: parsedBody.data.comboId ?? undefined,
      planoId: parsedBody.data.planoId ?? undefined,
      motivo: parsedBody.data.motivo ?? undefined,
      metadata: financialMetadata,
    });

    return NextResponse.json(
      {
        ...mapEditMatriculaResultToDTO(matricula as unknown as Record<string, unknown>),
        asyncSync: financialMetadata
          ? {
              provider: 'ASAAS',
              fields: ['value', 'updatePendingPayments'],
              message:
                'A troca de plano também atualizou o valor recorrente para manter coerência com os próximos ciclos financeiros.',
            }
          : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[EDITAR_MATRICULA] Erro:', error);
    if ((error as { name?: string }).name === 'ZodError') {
      return jsonError(422, 'ERRO_VALIDACAO', (error as Error).message, error);
    }
    if (error instanceof MatriculaConflictError) {
      return jsonError(409, error.code, error.message);
    }
    return jsonError(500, 'ERRO_EDITAR_MATRICULA', (error as Error).message);
  }
}
