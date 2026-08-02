import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  commitBillingAgreementChange,
  previewBillingAgreementChange,
} from '@alusa/finance';
import type { BillingAgreementChangeInput } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import { updateMatriculaValueInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionValueUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';

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
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
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

    const matriculaId = ctxParams.id;
    const { value, updatePendingPayments } = parsedBody.data;

    // Buscar matrícula
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId: contaCtx.contaId },
      },
      select: {
        id: true,
        contratoAtual: { select: { id: true, status: true } },
        subscriptions: {
          where: { contaId: contaCtx.contaId },
          select: { billingAgreementId: true },
          take: 1,
        },
        billingAllocations: {
          where: { contaId: contaCtx.contaId, kind: 'TUITION', status: { in: ['ACTIVE', 'SCHEDULED'] } },
          select: { id: true, agreementId: true, baseAmount: true, discountAmount: true, netAmount: true },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    const agreementId = matricula.billingAllocations[0]?.agreementId
      ?? matricula.subscriptions[0]?.billingAgreementId
      ?? null;
    const allocation = matricula.billingAllocations[0];
    if (!agreementId || !allocation) {
      return jsonError(409, 'ACORDO_FINANCEIRO_NAO_MATERIALIZADO', 'O vínculo financeiro precisa ser reconciliado antes da alteração.');
    }
    const agreement = await prisma.billingAgreement.findFirst({
      where: { id: agreementId, contaId: contaCtx.contaId },
      select: { version: true, nextDueDate: true, asaasSubscriptionId: true },
    });
    if (!agreement?.asaasSubscriptionId) {
      return jsonError(409, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui assinatura financeira confirmada.');
    }

    const today = new Date().toISOString().slice(0, 10);
    const effectivePolicy = updatePendingPayments ? 'CURRENT_CYCLE_FULL' as const : 'NEXT_CYCLE' as const;
    const effectiveDate = updatePendingPayments
      ? today
      : agreement.nextDueDate?.toISOString().slice(0, 10) ?? today;
    const amountCents = Math.round(value * 100);
    const change: BillingAgreementChangeInput = {
      kind: 'UPDATE_ALLOCATION' as const,
      contaId: contaCtx.contaId,
      agreementId,
      actorId: sessionUser?.id ?? 'system',
      reason: 'Alteração manual do valor da mensalidade',
      effectivePolicy,
      effectiveDate,
      allocations: [{
        allocationId: allocation.id,
        baseAmountCents: amountCents,
        discountAmountCents: 0,
        netAmountCents: amountCents,
      }],
    };
    const preview = await previewBillingAgreementChange(change);
    if (preview.blockers.length > 0) {
      return jsonError(422, 'ALTERACAO_FINANCEIRA_BLOQUEADA', preview.blockers[0] ?? 'Alteração bloqueada.', preview.blockers);
    }
    const uiRequestId = req.headers.get('idempotency-key')?.trim();
    if (!uiRequestId) {
      return jsonError(
        400,
        'IDEMPOTENCY_KEY_OBRIGATORIA',
        'Informe uma chave de idempotência para alterar o valor da matrícula.',
      );
    }
    const result = await commitBillingAgreementChange({
      ...change,
      uiRequestId,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt,
      expectedAgreementVersion: agreement.version,
    });

    await prisma.matriculaLog.create({
      data: {
        matriculaId,
        actorId: sessionUser?.id ?? 'system',
        action: 'MATRICULA_SUBSCRIPTION_VALUE_UPDATED',
        metadata: {
          billingAgreementId: agreementId,
          previousValue: Number(allocation.netAmount),
          nextValue: value,
          updatePendingPayments,
          operationId: result.operationId,
          operationStatus: result.status,
          requiresContractAmendment: matricula.contratoAtual?.status === 'ASSINADO',
        },
      },
    });

    if (matricula.contratoAtual?.status === 'ASSINADO') {
      await prisma.matriculaLog.create({
        data: {
          matriculaId,
          actorId: sessionUser?.id ?? 'system',
          action: 'CONTRATO_ADITIVO_REQUERIDO',
          metadata: {
            contratoOrigemId: matricula.contratoAtual.id,
            billingAgreementId: agreementId,
            billingOperationId: result.operationId,
            previousValue: Number(allocation.netAmount),
            nextValue: value,
            effectivePolicy,
            effectiveDate,
          },
        },
      });
    }

    return NextResponse.json(
      mapMatriculaSubscriptionValueUpdateResultToDTO({
        subscriptionId: agreement.asaasSubscriptionId,
        value,
        updatePendingPayments,
        message: result.status === 'REQUIRES_RECONCILIATION'
          ? 'A alteração foi registrada e será confirmada pela reconciliação financeira.'
          : updatePendingPayments
            ? 'Valor atualizado na Alusa e no Asaas, incluindo cobranças pendentes elegíveis.'
            : 'Valor agendado para o próximo ciclo, sem alterar cobranças já geradas.',
      }),
      {
        status: result.status === 'REQUIRES_RECONCILIATION' ? 202 : 200,
        headers: { 'cache-control': 'no-store' },
      },
    );
  } catch (error) {
    console.error('[ASAAS_SYNC] Erro ao atualizar valor:', error);
    return jsonError(500, 'ERRO_ATUALIZAR_VALOR', (error as Error).message);
  }
}
