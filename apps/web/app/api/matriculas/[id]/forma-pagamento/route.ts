import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  KycNotApprovedError,
  projectConfirmedBillingAgreementSnapshot,
  updateSubscription,
} from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { runWithTenant } from '@/lib/prisma-tenant';
import { updateMatriculaBillingTypeInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionBillingTypeUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { deriveLocalAssinaturaSnapshot } from '@/src/server/matriculas/subscription-snapshot';
import { mapBillingTypeToFormaPagamento } from '@/src/server/matriculas/recurring-billing';
import { alignLocalPendingEnrollmentCharges } from '@/src/server/matriculas/enrollment-finance-consistency.service';
import {
  isFinancialContextEditable,
  resolveMatriculaFinancialContext,
  updateFamilyFinancialLocalState,
} from '@/src/server/matriculas/financial-context.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

// Mesma política das mutações de cobrança: recepção não altera condições financeiras.
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * PUT /api/matriculas/[id]/forma-pagamento
 * Atualiza a forma de pagamento da assinatura no Asaas
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ctxParams = await ctx.params;
  try {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user;
    const contaId = sessionUser?.contaId?.trim();
    const actorId = sessionUser?.id?.trim();
    if (!actorId || !contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
    }
    if (!allowedRoles.has(String(sessionUser?.role ?? '').toUpperCase())) {
      return jsonError(403, 'SEM_PERMISSAO', 'Usuário sem permissão para alterar condições financeiras.');
    }
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

    const requestedContaId = parsedBody.data.contaId?.trim();
    if (requestedContaId && requestedContaId !== contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const matriculaId = ctxParams.id;
    const { billingType } = parsedBody.data;

    // Buscar matrícula
    const matricula = await runWithTenant(contaId, (tx) => tx.matricula.findFirst({
      where: {
        id: matriculaId,
        aluno: { contaId },
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
    }));

    if (!matricula) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');
    }

    const financialContext = await runWithTenant(contaId, (tx) => resolveMatriculaFinancialContext({
      db: tx,
      matriculaId,
      contaId,
    }));
    const targetSubscriptionId =
      financialContext?.asaasSubscriptionId ?? matricula.asaasSubscriptionId;

    if (!financialContext || !targetSubscriptionId) {
      return jsonError(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
    }

    const localSnapshot =
      financialContext.mode === 'FAMILY' || financialContext.sharedAgreement
        ? financialContext.localSnapshot
        : deriveLocalAssinaturaSnapshot(
            matricula as unknown as Record<string, unknown>,
            await runWithTenant(contaId, (tx) => tx.subscription.findFirst({
              where: {
                contaId,
                matriculaId: matricula.id,
              },
              select: {
                status: true,
                updatedAt: true,
              },
            })),
          );

    if (!isFinancialContextEditable(financialContext)) {
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
        targetSubscriptionId,
        {
          billingType: billingType as 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED',
          updatePendingPayments: true,
        },
        {
          contaId,
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

    await projectConfirmedBillingAgreementSnapshot({
      contaId,
      asaasSubscriptionId: targetSubscriptionId,
      billingType,
    });

    await runWithTenant(contaId, (tx) => tx.matriculaLog.create({
      data: {
        matriculaId,
        actorId,
        action: 'MATRICULA_SUBSCRIPTION_BILLING_TYPE_UPDATED',
        metadata: {
          asaasSubscriptionId: targetSubscriptionId,
          mode: financialContext.mode,
          familyGroupId: financialContext.family?.id ?? null,
          affectedMatriculaIds:
            financialContext.family?.affectedMatriculaIds ??
            financialContext.sharedAgreement?.affectedMatriculaIds ??
            [matriculaId],
          previousBillingType: localSnapshot?.billingType ?? null,
          nextBillingType: billingType,
          updatePendingPayments: true,
        },
      },
    }));

    const nextFormaPagamento = mapBillingTypeToFormaPagamento(billingType);
    let localAlignment = null;
    if (financialContext.mode === 'FAMILY') {
      localAlignment = await runWithTenant(contaId, (tx) => updateFamilyFinancialLocalState({
        db: tx,
        context: financialContext,
        billingType,
      }));
    } else if (nextFormaPagamento) {
      const affectedMatriculaIds =
        financialContext.sharedAgreement?.affectedMatriculaIds ?? [matriculaId];
      await runWithTenant(contaId, (tx) => tx.matricula.updateMany({
        where: { contaId, id: { in: affectedMatriculaIds } },
        data: { formaPagamento: nextFormaPagamento },
      }));
      const alignments = await Promise.all(
        affectedMatriculaIds.map((affectedMatriculaId) =>
          runWithTenant(contaId, (tx) => alignLocalPendingEnrollmentCharges({
            db: tx,
            matriculaId: affectedMatriculaId,
            contaId,
            billingType: nextFormaPagamento,
            chargeBillingType: billingType,
          })),
        ),
      );
      localAlignment = {
        cobrancasUpdated: alignments.reduce((sum, item) => sum + item.cobrancasUpdated, 0),
        chargesUpdated: alignments.reduce((sum, item) => sum + item.chargesUpdated, 0),
        matriculasUpdated: alignments.length,
      };
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
    return jsonError(500, 'ERRO_ATUALIZAR_FORMA_PAGAMENTO', 'Não foi possível atualizar a forma de pagamento.');
  }
}
