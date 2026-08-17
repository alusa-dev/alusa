import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getSubscription,
  projectConfirmedBillingAllocationValues,
  updateSubscription,
} from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { editarMatricula, MatriculaConflictError } from '@/src/server/matriculas/matricula.service';
import { editMatriculaInputDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapEditMatriculaResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import { alignLocalPendingEnrollmentCharges } from '@/src/server/matriculas/enrollment-finance-consistency.service';
import {
  isFinancialContextEditable,
  resolveMatriculaFinancialContext,
  updateFamilyFinancialLocalState,
} from '@/src/server/matriculas/financial-context.service';
import { mapPeriodicidadeToCycle } from '@/src/server/matriculas/recurring-billing';
import type { PeriodicidadePlano } from '@prisma/client';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

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

type ProductPricing = {
  kind: 'PLAN' | 'COMBO';
  id: string;
  nome: string;
  value: number;
  periodicidade: PeriodicidadePlano;
  cycle: ReturnType<typeof mapPeriodicidadeToCycle>;
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

async function resolveProductPricing(input: {
  contaId: string;
  planoId?: string | null;
  comboId?: string | null;
}): Promise<ProductPricing | null> {
  if (input.comboId) {
    const combo = await prisma.combo.findFirst({
      where: { id: input.comboId, contaId: input.contaId },
      select: { id: true, nome: true, valor: true, periodicidade: true },
    });

    if (!combo) return null;

    return {
      kind: 'COMBO',
      id: combo.id,
      nome: combo.nome,
      value: Number(combo.valor),
      periodicidade: combo.periodicidade,
      cycle: mapPeriodicidadeToCycle(combo.periodicidade),
    };
  }

  if (input.planoId) {
    const plano = await prisma.plano.findFirst({
      where: { id: input.planoId, contaId: input.contaId },
      select: { id: true, nome: true, valor: true, periodicidade: true },
    });

    if (!plano) return null;

    return {
      kind: 'PLAN',
      id: plano.id,
      nome: plano.nome,
      value: Number(plano.valor),
      periodicidade: plano.periodicidade,
      cycle: mapPeriodicidadeToCycle(plano.periodicidade),
    };
  }

  return null;
}

async function resolveFamilyPricing(input: {
  contaId: string;
  affectedMatriculaIds: string[];
  editedMatriculaId: string;
  editedPricing: ProductPricing;
}) {
  const familyItems = await prisma.matricula.findMany({
    where: {
      contaId: input.contaId,
      id: { in: input.affectedMatriculaIds },
    },
    select: {
      id: true,
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
      combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
    },
  });

  if (familyItems.length !== input.affectedMatriculaIds.length) {
    return {
      ok: false as const,
      code: 'MATRICULA_FAMILIAR_INCOMPLETA',
      message: 'Não foi possível carregar todas as matrículas da cobrança familiar nesta conta.',
    };
  }

  const pricing = familyItems.map((item) => {
    if (item.id === input.editedMatriculaId) {
      return { ...input.editedPricing, matriculaId: item.id };
    }

    const product = item.combo ?? item.plano;
    if (!product) return null;

    return {
      kind: item.combo ? ('COMBO' as const) : ('PLAN' as const),
      matriculaId: item.id,
      value: Number(product.valor),
      periodicidade: product.periodicidade,
      cycle: mapPeriodicidadeToCycle(product.periodicidade),
    };
  });

  if (pricing.some((item) => item == null)) {
    return {
      ok: false as const,
      code: 'PRODUTO_FAMILIAR_INCOMPLETO',
      message: 'Todas as matrículas familiares precisam ter plano ou combo com valor e periodicidade.',
    };
  }

  const resolvedPricing = pricing as Array<{
    kind: 'COMBO' | 'PLAN';
    matriculaId: string;
    value: number;
    periodicidade: PeriodicidadePlano;
    cycle: ReturnType<typeof mapPeriodicidadeToCycle>;
  }>;
  const cycles = new Set(resolvedPricing.map((item) => item.cycle));
  const kinds = new Set(resolvedPricing.map((item) => item.kind));

  if (cycles.size !== 1) {
    return {
      ok: false as const,
      code: 'PERIODICIDADE_FAMILIAR_DIVERGENTE',
      message: 'As matrículas familiares precisam compartilhar a mesma periodicidade para manter uma assinatura consolidada.',
    };
  }

  if (kinds.size !== 1) {
    return {
      ok: false as const,
      code: 'SEMANTICA_FAMILIAR_DIVERGENTE',
      message: 'Não é possível misturar plano familiar agregado e combos individualizados na mesma cobrança.',
    };
  }

  // Planos familiares são precificados por matrícula. A assinatura consolidada
  // deve representar a soma dos valores de todos os alunos, e não apenas o
  // valor do plano que está sendo editado. Combos continuam usando o valor
  // próprio de cada matrícula.
  const totalValue = Number(
    resolvedPricing.reduce((sum, item) => sum + item.value, 0).toFixed(2),
  );
  return {
    ok: true as const,
    value: totalValue,
    cycle: resolvedPricing[0]?.cycle ?? input.editedPricing.cycle,
    allocationValues: resolvedPricing.map((item) => ({
      matriculaId: item.matriculaId,
      value: Number(item.value.toFixed(2)),
    })),
  };
}

/**
 * Uma assinatura canônica pode representar mais de uma matrícula individual.
 * O valor enviado ao Asaas é sempre a soma das alocações, nunca o valor isolado
 * da matrícula que está sendo editada.
 */
async function resolveSharedAgreementPricing(input: {
  contaId: string;
  agreementId: string;
  editedMatriculaId: string;
  editedPricing: ProductPricing;
}) {
  const allocations = await prisma.billingAllocation.findMany({
    where: {
      contaId: input.contaId,
      agreementId: input.agreementId,
      kind: 'TUITION',
      status: { in: ['ACTIVE', 'SCHEDULED'] },
      recurring: true,
    },
    select: { matriculaId: true, netAmount: true },
  });

  if (!allocations.some((allocation) => allocation.matriculaId === input.editedMatriculaId)) {
    return {
      ok: false as const,
      code: 'ALOCACAO_CANONICA_AUSENTE',
      message: 'A matrícula não possui uma alocação recorrente ativa no acordo financeiro.',
    };
  }

  const relatedMatriculas = await prisma.matricula.findMany({
    where: { contaId: input.contaId, id: { in: allocations.map((item) => item.matriculaId) } },
    select: {
      id: true,
      plano: { select: { periodicidade: true } },
      combo: { select: { periodicidade: true } },
    },
  });
  if (relatedMatriculas.length !== allocations.length) {
    return {
      ok: false as const,
      code: 'ACORDO_CANONICO_INCOMPLETO',
      message: 'Não foi possível carregar todas as matrículas vinculadas à assinatura compartilhada.',
    };
  }

  const cycles = new Set<string>();
  for (const matricula of relatedMatriculas) {
    if (matricula.id === input.editedMatriculaId) {
      cycles.add(input.editedPricing.cycle);
      continue;
    }
    const product = matricula.combo ?? matricula.plano;
    if (!product) {
      return {
        ok: false as const,
        code: 'PRODUTO_ASSINATURA_COMPARTILHADA_INCOMPLETO',
        message: 'Todas as matrículas na assinatura compartilhada precisam possuir plano ou combo.',
      };
    }
    cycles.add(mapPeriodicidadeToCycle(product.periodicidade));
  }
  if (cycles.size !== 1 || !cycles.has(input.editedPricing.cycle)) {
    return {
      ok: false as const,
      code: 'PERIODICIDADE_ASSINATURA_COMPARTILHADA_DIVERGENTE',
      message: 'Matrículas na mesma assinatura devem possuir a mesma periodicidade.',
    };
  }

  const allocationValues = allocations.map((allocation) => ({
    matriculaId: allocation.matriculaId,
    value:
      allocation.matriculaId === input.editedMatriculaId
        ? input.editedPricing.value
        : Number(allocation.netAmount),
  }));
  return {
    ok: true as const,
    cycle: input.editedPricing.cycle,
    allocationValues,
    value: Number(allocationValues.reduce((sum, item) => sum + item.value, 0).toFixed(2)),
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

    try {
      await assertPlatformAccessForConta({ contaId: contaCtx.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
      throw error;
    }

    const currentMatricula = await prisma.matricula.findFirst({
      where: { id: ctxParams.id, aluno: { contaId: contaCtx.contaId } },
      select: {
        id: true,
        planoId: true,
        comboId: true,
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

    const financialContext = await resolveMatriculaFinancialContext({
      db: prisma,
      matriculaId: currentMatricula.id,
      contaId: contaCtx.contaId,
    });
    const targetSubscriptionId =
      financialContext?.asaasSubscriptionId ?? currentMatricula.asaasSubscriptionId ?? null;
    const nextPlanoId =
      typeof parsedBody.data.planoId !== 'undefined'
        ? parsedBody.data.planoId
        : currentMatricula.planoId;
    const nextComboId =
      typeof parsedBody.data.comboId !== 'undefined'
        ? parsedBody.data.comboId
        : currentMatricula.comboId;
    const productChanged =
      nextPlanoId !== currentMatricula.planoId ||
      nextComboId !== currentMatricula.comboId;

    let financialMetadata: Record<string, unknown> | undefined;
    let nextSubscriptionValue: number | null = null;
    let nextSubscriptionCycle: ReturnType<typeof mapPeriodicidadeToCycle> | null = null;
    let pendingFamilyLocalUpdate:
      | {
          value: number;
          cycle: ReturnType<typeof mapPeriodicidadeToCycle>;
        }
      | null = null;
    let pendingCanonicalAllocationValues: Array<{ matriculaId: string; value: number }> | null = null;

    if (productChanged && targetSubscriptionId) {
      if (!financialContext) {
        return jsonError(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
      }

      if (!isFinancialContextEditable(financialContext)) {
        return jsonError(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
      }

      const nextPricing = await resolveProductPricing({
        contaId: contaCtx.contaId,
        planoId: nextPlanoId,
        comboId: nextComboId,
      });

      if (!nextPricing) {
        return jsonError(
          404,
          nextComboId ? 'COMBO_NAO_ENCONTRADO' : 'PLANO_NAO_ENCONTRADO',
          nextComboId
            ? 'Combo não encontrado para a conta informada.'
            : 'Plano não encontrado para a conta informada.',
        );
      }

      let remoteSubscription: Awaited<ReturnType<typeof getSubscription>>;

      try {
        remoteSubscription = await getSubscription(targetSubscriptionId, {
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

      if (financialContext.mode === 'FAMILY' && financialContext.family) {
        const familyPricing = await resolveFamilyPricing({
          contaId: contaCtx.contaId,
          affectedMatriculaIds: financialContext.family.affectedMatriculaIds,
          editedMatriculaId: currentMatricula.id,
          editedPricing: nextPricing,
        });

        if (!familyPricing.ok) {
          return jsonError(422, familyPricing.code, familyPricing.message);
        }

        nextSubscriptionValue = familyPricing.value;
        nextSubscriptionCycle = familyPricing.cycle;
        pendingFamilyLocalUpdate = {
          value: familyPricing.value,
          cycle: familyPricing.cycle,
        };
        pendingCanonicalAllocationValues = familyPricing.allocationValues;
      } else if (financialContext.sharedAgreement) {
        const sharedPricing = await resolveSharedAgreementPricing({
          contaId: contaCtx.contaId,
          agreementId: financialContext.sharedAgreement.id,
          editedMatriculaId: currentMatricula.id,
          editedPricing: nextPricing,
        });
        if (!sharedPricing.ok) {
          return jsonError(422, sharedPricing.code, sharedPricing.message);
        }
        nextSubscriptionValue = sharedPricing.value;
        nextSubscriptionCycle = sharedPricing.cycle;
        pendingCanonicalAllocationValues = sharedPricing.allocationValues;
      } else {
        nextSubscriptionValue = nextPricing.value;
        nextSubscriptionCycle = nextPricing.cycle;
        pendingCanonicalAllocationValues = [{ matriculaId: currentMatricula.id, value: nextPricing.value }];
      }

      const resolvedNextSubscriptionValue = nextSubscriptionValue;

      const previousValue =
        typeof remoteSubscription.value === 'number'
          ? remoteSubscription.value
          : financialContext.localSnapshot?.value ?? null;
      const previousCycle =
        typeof remoteSubscription.cycle === 'string' && remoteSubscription.cycle.length > 0
          ? remoteSubscription.cycle
          : null;
      const subscriptionPayload: Parameters<typeof updateSubscription>[1] = {
        updatePendingPayments: true,
      };

      if (previousValue !== resolvedNextSubscriptionValue) {
        subscriptionPayload.value = resolvedNextSubscriptionValue;
      }

      if (nextSubscriptionCycle && previousCycle !== nextSubscriptionCycle) {
        subscriptionPayload.cycle = nextSubscriptionCycle;
      }

      if (subscriptionPayload.value !== undefined || subscriptionPayload.cycle !== undefined) {
        try {
          await updateSubscription(
            targetSubscriptionId,
            subscriptionPayload,
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
          kind: 'PRODUCT_RECURRING_TERMS_UPDATED',
          mode: financialContext.mode,
          familyGroupId: financialContext.family?.id ?? null,
          affectedMatriculaIds:
            financialContext.family?.affectedMatriculaIds ??
            financialContext.sharedAgreement?.affectedMatriculaIds ??
            [currentMatricula.id],
          asaasSubscriptionId: targetSubscriptionId,
          productKind: nextPricing.kind,
          productId: nextPricing.id,
          productName: nextPricing.nome,
          previousValue,
          nextValue: resolvedNextSubscriptionValue,
          previousCycle,
          nextCycle: nextSubscriptionCycle,
          previousPlanoId: currentMatricula.planoId,
          nextPlanoId,
          previousComboId: currentMatricula.comboId,
          nextComboId,
          updatePendingPayments: true,
        },
      };
    }

    const matricula = await editarMatricula({
      matriculaId: ctxParams.id,
      contaId: contaCtx.contaId,
      createdById: contaCtx.sessionUserId,
      turmaId: parsedBody.data.turmaId === undefined ? undefined : parsedBody.data.turmaId,
      comboId: parsedBody.data.comboId === undefined ? undefined : parsedBody.data.comboId,
      planoId: parsedBody.data.planoId === undefined ? undefined : parsedBody.data.planoId,
      motivo: parsedBody.data.motivo ?? undefined,
      metadata: financialMetadata,
    });

    if (targetSubscriptionId && nextSubscriptionValue != null && pendingCanonicalAllocationValues) {
      await projectConfirmedBillingAllocationValues({
        contaId: contaCtx.contaId,
        asaasSubscriptionId: targetSubscriptionId,
        totalValue: nextSubscriptionValue,
        cycle: nextSubscriptionCycle,
        allocations: pendingCanonicalAllocationValues,
      });
    }

    const localAlignment =
      pendingFamilyLocalUpdate && financialContext
        ? await updateFamilyFinancialLocalState({
            db: prisma,
            context: financialContext,
            value: pendingFamilyLocalUpdate.value,
            cycle: pendingFamilyLocalUpdate.cycle,
          })
        : financialMetadata && pendingCanonicalAllocationValues
          ? await Promise.all(
              pendingCanonicalAllocationValues.map((allocation) =>
                alignLocalPendingEnrollmentCharges({
                  db: prisma,
                  matriculaId: allocation.matriculaId,
                  contaId: contaCtx.contaId!,
                  value: allocation.value,
                }),
              ),
            ).then((results) => ({
              cobrancasUpdated: results.reduce((sum, result) => sum + result.cobrancasUpdated, 0),
              chargesUpdated: results.reduce((sum, result) => sum + result.chargesUpdated, 0),
              matriculasUpdated: results.length,
            }))
          : null;

    return NextResponse.json(
      {
        ...mapEditMatriculaResultToDTO(matricula as unknown as Record<string, unknown>),
        asyncSync: financialMetadata
          ? {
              provider: 'ASAAS',
              fields: [
                ...(nextSubscriptionValue !== null ? ['value'] : []),
                ...(nextSubscriptionCycle ? ['cycle'] : []),
                'updatePendingPayments',
              ],
              ...(nextSubscriptionCycle ? { cycle: nextSubscriptionCycle } : {}),
              localAlignment,
              message:
                'A troca de plano ou combo também atualizou a assinatura recorrente para manter coerência com os próximos ciclos financeiros.',
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
