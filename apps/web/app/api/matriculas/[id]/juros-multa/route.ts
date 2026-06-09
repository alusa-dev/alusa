import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getSubscription, KycNotApprovedError, updateSubscription } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import { updateMatriculaJurosMultaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionTermsUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { alignLocalPendingEnrollmentCharges } from '@/src/server/matriculas/enrollment-finance-consistency.service';
import {
  isFinancialContextEditable,
  resolveMatriculaFinancialContext,
  updateFamilyFinancialLocalState,
} from '@/src/server/matriculas/financial-context.service';
import { syncEditableSubscriptionPayments } from '@/src/server/matriculas/subscription-pending-payments-sync';

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

type AsaasTermsSnapshot = {
  interest?: { value?: number | null } | null;
  fine?: { value?: number | null; type?: string | null } | null;
  discount?: { value?: number | null; type?: string | null; dueDateLimitDays?: number | null } | null;
};

function normalizeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function normalizeAdjustmentType(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.toUpperCase() : null;
}

function termsMatchRemote(
  remote: AsaasTermsSnapshot,
  expected: {
    interest?: { value: number };
    fine?: { value: number; type?: string };
    discount?: { value: number; type?: string; dueDateLimitDays?: number };
  },
) {
  if (expected.interest && normalizeNumber(remote.interest?.value) !== normalizeNumber(expected.interest.value)) {
    return false;
  }

  if (expected.fine) {
    if (normalizeNumber(remote.fine?.value) !== normalizeNumber(expected.fine.value)) return false;
    if (
      expected.fine.type &&
      normalizeAdjustmentType(remote.fine?.type) !== normalizeAdjustmentType(expected.fine.type)
    ) {
      return false;
    }
  }

  if (expected.discount) {
    if (normalizeNumber(remote.discount?.value) !== normalizeNumber(expected.discount.value)) return false;
    if (
      expected.discount.type &&
      normalizeAdjustmentType(remote.discount?.type) !== normalizeAdjustmentType(expected.discount.type)
    ) {
      return false;
    }
    if (Number(remote.discount?.dueDateLimitDays ?? 0) !== Number(expected.discount.dueDateLimitDays ?? 0)) {
      return false;
    }
  }

  return true;
}

/**
 * PUT /api/matriculas/[id]/juros-multa
 * Atualiza juros e multa da assinatura no Asaas
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const sessionUser = await resolveSessionUser();
    const json = await req.json().catch(() => null);

    const parsedBody = updateMatriculaJurosMultaInputDTOSchema.safeParse(json);
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
    const { interest, fine, discount } = parsedBody.data;

    // Buscar matrícula
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: contaCtx.contaId },
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
      },
    });

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    const financialContext = await resolveMatriculaFinancialContext({
      db: prisma,
      matriculaId,
      contaId: contaCtx.contaId,
    });
    const targetSubscriptionId =
      financialContext?.asaasSubscriptionId ?? matricula.asaasSubscriptionId;

    if (!financialContext || !targetSubscriptionId) {
      return jsonError(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
    }

    const localSubscription = await prisma.subscription.findFirst({
      where: {
        contaId: contaCtx.contaId,
        matriculaId: matricula.id,
      },
      select: {
        status: true,
      },
    });

    if (!isFinancialContextEditable(financialContext)) {
      return jsonError(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
    }

    const asaasInterest = interest ? { value: interest.value as number } : undefined;
    const asaasFine = fine ? { value: fine.value as number, type: fine.type } : undefined;
    const asaasDiscount = discount
      ? {
          value: discount.value,
          type: discount.type,
          dueDateLimitDays: discount.dueDateLimitDays ?? 0,
        }
      : undefined;
    const asaasPayload = {
      ...(asaasInterest ? { interest: asaasInterest } : {}),
      ...(asaasFine ? { fine: asaasFine } : {}),
      ...(asaasDiscount ? { discount: asaasDiscount } : {}),
      updatePendingPayments: true,
    };

    try {
      const updatedRemote = await updateSubscription(targetSubscriptionId, asaasPayload, {
        contaId: contaCtx.contaId,
      });

      const remoteTerms =
        termsMatchRemote(updatedRemote as AsaasTermsSnapshot, {
          ...(asaasInterest ? { interest: asaasInterest } : {}),
          ...(asaasFine ? { fine: asaasFine } : {}),
          ...(asaasDiscount ? { discount: asaasDiscount } : {}),
        })
          ? updatedRemote
          : await getSubscription(targetSubscriptionId, { contaId: contaCtx.contaId });

      if (
        !termsMatchRemote(remoteTerms as AsaasTermsSnapshot, {
          ...(asaasInterest ? { interest: asaasInterest } : {}),
          ...(asaasFine ? { fine: asaasFine } : {}),
          ...(asaasDiscount ? { discount: asaasDiscount } : {}),
        })
      ) {
        return jsonError(
          502,
          'ASAAS_TERMS_NOT_CONFIRMED',
          'O Asaas aceitou a requisição, mas os termos financeiros retornados ainda não refletem a alteração. Tente novamente em instantes.',
          {
            expected: {
              interest: asaasInterest ?? null,
              fine: asaasFine ?? null,
              discount: asaasDiscount ?? null,
            },
          },
        );
      }
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

    const remotePaymentsAlignment = await syncEditableSubscriptionPayments({
      contaId: contaCtx.contaId,
      asaasSubscriptionId: targetSubscriptionId,
      terms: {
        interest: asaasInterest ?? null,
        fine: asaasFine ?? null,
        discount: asaasDiscount ?? null,
      },
    });

    const updateData = {
      jurosMensal: interest?.value ?? null,
      jurosTipo: interest ? 'PERCENTAGE' : null,
      multaPercentual: fine?.value ?? null,
      multaTipo: fine?.type ?? null,
      descontoAntecipado: discount && discount.value > 0 ? discount.value : null,
      descontoTipo: discount && discount.value > 0 ? discount.type ?? null : null,
      prazoDesconto: discount && discount.value > 0 ? discount.dueDateLimitDays ?? null : null,
    };
    const updatedMatricula =
      financialContext.mode === 'FAMILY'
        ? await prisma.matricula.update({
            where: { id: financialContext.sourceMatriculaId },
            data: updateData,
          })
        : await prisma.matricula.update({
            where: { id: matriculaId },
            data: updateData,
          });

    if (financialContext.mode === 'FAMILY' && financialContext.family) {
      await prisma.matricula.updateMany({
        where: {
          contaId: contaCtx.contaId,
          id: { in: financialContext.family.affectedMatriculaIds },
        },
        data: updateData,
      });
    }

    await prisma.matriculaLog.create({
      data: {
        matriculaId,
        actorId: sessionUser?.id ?? 'system',
        action: 'MATRICULA_SUBSCRIPTION_TERMS_UPDATED',
        metadata: {
          asaasSubscriptionId: targetSubscriptionId,
          mode: financialContext.mode,
          familyGroupId: financialContext.family?.id ?? null,
          affectedMatriculaIds: financialContext.family?.affectedMatriculaIds ?? [matriculaId],
          previousSubscriptionStatus: localSubscription?.status ?? 'UNKNOWN',
          interest: asaasInterest ? { ...asaasInterest, type: 'PERCENTAGE' } : null,
          fine,
          discount: asaasDiscount ?? null,
          updatePendingPayments: true,
        },
      },
    });

    const localAlignment =
      financialContext.mode === 'FAMILY'
        ? await updateFamilyFinancialLocalState({
            db: prisma,
            context: financialContext,
            interest: interest ? { value: interest.value } : null,
            fine: fine ? { value: fine.value, type: fine.type ?? 'PERCENTAGE' } : null,
            discount: discount
              ? {
                  value: discount.value,
                  type: discount.type ?? 'FIXED',
                  dueDateLimitDays: discount.dueDateLimitDays ?? 0,
                }
              : null,
          })
        : await alignLocalPendingEnrollmentCharges({
            db: prisma,
            matriculaId,
            contaId: contaCtx.contaId,
            interest: interest ? { value: interest.value, type: 'PERCENTAGE' } : null,
            fine: fine ? { value: fine.value, type: fine.type ?? 'PERCENTAGE' } : null,
            discount: discount
              ? {
                  value: discount.value,
                  type: discount.type ?? 'FIXED',
                  dueDateLimitDays: discount.dueDateLimitDays ?? 0,
                }
              : null,
          });

    const response = mapMatriculaSubscriptionTermsUpdateResultToDTO({
      interest,
      fine,
      discount,
      updated: {
        jurosMensal: updatedMatricula.jurosMensal ? Number(updatedMatricula.jurosMensal) : null,
        jurosTipo: updatedMatricula.jurosTipo ?? null,
        multaPercentual: updatedMatricula.multaPercentual ? Number(updatedMatricula.multaPercentual) : null,
        multaTipo: updatedMatricula.multaTipo ?? null,
        descontoAntecipado: updatedMatricula.descontoAntecipado
          ? Number(updatedMatricula.descontoAntecipado)
          : null,
        descontoTipo: updatedMatricula.descontoTipo ?? null,
        prazoDesconto: updatedMatricula.prazoDesconto ?? null,
      },
      message: 'Juros, multa e desconto atualizados com sucesso',
    });

    return NextResponse.json(
      {
        ...response,
        asyncSync: {
          provider: 'ASAAS',
          fields: ['interest', 'fine', 'discount', 'updatePendingPayments', 'pendingPayments'],
          remotePaymentsAlignment,
          localAlignment,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[ASAAS_SYNC] Erro ao atualizar juros e multa:', error);

    if (error instanceof KycNotApprovedError) {
      return jsonError(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }
    return jsonError(500, 'ERRO_ATUALIZAR_JUROS_MULTA', (error as Error).message);
  }
}
