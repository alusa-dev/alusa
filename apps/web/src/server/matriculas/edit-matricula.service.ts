import { z } from 'zod';

import {
  getSubscription,
  projectConfirmedBillingAllocationValues,
  updateSubscription,
} from '@alusa/finance';
import { type PeriodicidadePlano } from '@prisma/client';

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
import { matriculaRouteRepository } from '@/src/server/matriculas/matricula-route.repository';
import { editarMatricula } from '@/src/server/matriculas/matricula.service';

type EditMatriculaInput = z.infer<typeof editMatriculaInputDTOSchema>;

export class EditMatriculaHttpError extends Error {
  public readonly status: 400 | 404 | 409 | 422 | 502;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    status: 400 | 404 | 409 | 422 | 502,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'EditMatriculaHttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(status: 400 | 404 | 409 | 422 | 502, code: string, message: string, details?: unknown): never {
  throw new EditMatriculaHttpError(status, code, message, details);
}

type ProductPricing = {
  kind: 'PLAN' | 'COMBO';
  id: string;
  nome: string;
  value: number;
  periodicidade: PeriodicidadePlano;
  cycle: ReturnType<typeof mapPeriodicidadeToCycle>;
};

async function resolveProductPricing(input: {
  contaId: string;
  planoId?: string | null;
  comboId?: string | null;
}): Promise<ProductPricing | null> {
  if (input.comboId) {
    const combo = await matriculaRouteRepository.combo.findFirst({
      where: { id: input.comboId, contaId: input.contaId },
      select: { id: true, nome: true, valor: true, periodicidade: true },
    });
    return combo ? {
      kind: 'COMBO',
      id: combo.id,
      nome: combo.nome,
      value: Number(combo.valor),
      periodicidade: combo.periodicidade,
      cycle: mapPeriodicidadeToCycle(combo.periodicidade),
    } : null;
  }
  if (!input.planoId) return null;
  const plano = await matriculaRouteRepository.plano.findFirst({
    where: { id: input.planoId, contaId: input.contaId },
    select: { id: true, nome: true, valor: true, periodicidade: true },
  });
  return plano ? {
    kind: 'PLAN',
    id: plano.id,
    nome: plano.nome,
    value: Number(plano.valor),
    periodicidade: plano.periodicidade,
    cycle: mapPeriodicidadeToCycle(plano.periodicidade),
  } : null;
}

async function resolveFamilyPricing(input: {
  contaId: string;
  affectedMatriculaIds: string[];
  editedMatriculaId: string;
  editedPricing: ProductPricing;
}) {
  const familyItems = await matriculaRouteRepository.matricula.findMany({
    where: { contaId: input.contaId, id: { in: input.affectedMatriculaIds } },
    select: {
      id: true,
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true } },
      combo: { select: { id: true, nome: true, valor: true, periodicidade: true } },
    },
  });
  if (familyItems.length !== input.affectedMatriculaIds.length) {
    return { ok: false as const, code: 'MATRICULA_FAMILIAR_INCOMPLETA', message: 'Não foi possível carregar todas as matrículas da cobrança familiar nesta conta.' };
  }
  const pricing = familyItems.map((item) => {
    if (item.id === input.editedMatriculaId) return { ...input.editedPricing, matriculaId: item.id };
    const product = item.combo ?? item.plano;
    return product ? {
      kind: item.combo ? ('COMBO' as const) : ('PLAN' as const),
      matriculaId: item.id,
      value: Number(product.valor),
      periodicidade: product.periodicidade,
      cycle: mapPeriodicidadeToCycle(product.periodicidade),
    } : null;
  });
  if (pricing.some((item) => item == null)) {
    return { ok: false as const, code: 'PRODUTO_FAMILIAR_INCOMPLETO', message: 'Todas as matrículas familiares precisam ter plano ou combo com valor e periodicidade.' };
  }
  const resolved = pricing as Array<{ kind: 'COMBO' | 'PLAN'; matriculaId: string; value: number; periodicidade: PeriodicidadePlano; cycle: ReturnType<typeof mapPeriodicidadeToCycle> }>;
  if (new Set(resolved.map((item) => item.cycle)).size !== 1) {
    return { ok: false as const, code: 'PERIODICIDADE_FAMILIAR_DIVERGENTE', message: 'As matrículas familiares precisam compartilhar a mesma periodicidade para manter uma assinatura consolidada.' };
  }
  if (new Set(resolved.map((item) => item.kind)).size !== 1) {
    return { ok: false as const, code: 'SEMANTICA_FAMILIAR_DIVERGENTE', message: 'Não é possível misturar plano familiar agregado e combos individualizados na mesma cobrança.' };
  }
  return {
    ok: true as const,
    value: Number(resolved.reduce((sum, item) => sum + item.value, 0).toFixed(2)),
    cycle: resolved[0]?.cycle ?? input.editedPricing.cycle,
    allocationValues: resolved.map((item) => ({ matriculaId: item.matriculaId, value: Number(item.value.toFixed(2)) })),
  };
}

async function resolveSharedAgreementPricing(input: {
  contaId: string;
  agreementId: string;
  editedMatriculaId: string;
  editedPricing: ProductPricing;
}) {
  const allocations = await matriculaRouteRepository.billingAllocation.findMany({
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
    return { ok: false as const, code: 'ALOCACAO_CANONICA_AUSENTE', message: 'A matrícula não possui uma alocação recorrente ativa no acordo financeiro.' };
  }
  const related = await matriculaRouteRepository.matricula.findMany({
    where: { contaId: input.contaId, id: { in: allocations.map((item) => item.matriculaId) } },
    select: { id: true, plano: { select: { periodicidade: true } }, combo: { select: { periodicidade: true } } },
  });
  if (related.length !== allocations.length) {
    return { ok: false as const, code: 'ACORDO_CANONICO_INCOMPLETO', message: 'Não foi possível carregar todas as matrículas vinculadas à assinatura compartilhada.' };
  }
  const cycles = new Set<string>();
  for (const matricula of related) {
    if (matricula.id === input.editedMatriculaId) {
      cycles.add(input.editedPricing.cycle);
      continue;
    }
    const product = matricula.combo ?? matricula.plano;
    if (!product) return { ok: false as const, code: 'PRODUTO_ASSINATURA_COMPARTILHADA_INCOMPLETO', message: 'Todas as matrículas na assinatura compartilhada precisam possuir plano ou combo.' };
    cycles.add(mapPeriodicidadeToCycle(product.periodicidade));
  }
  if (cycles.size !== 1 || !cycles.has(input.editedPricing.cycle)) {
    return { ok: false as const, code: 'PERIODICIDADE_ASSINATURA_COMPARTILHADA_DIVERGENTE', message: 'Matrículas na mesma assinatura devem possuir a mesma periodicidade.' };
  }
  const allocationValues = allocations.map((allocation) => ({
    matriculaId: allocation.matriculaId,
    value: allocation.matriculaId === input.editedMatriculaId ? input.editedPricing.value : Number(allocation.netAmount),
  }));
  return {
    ok: true as const,
    cycle: input.editedPricing.cycle,
    allocationValues,
    value: Number(allocationValues.reduce((sum, item) => sum + item.value, 0).toFixed(2)),
  };
}

export async function editMatriculaForHttp(input: {
  matriculaId: string;
  contaId: string;
  userId: string;
  body: EditMatriculaInput;
}) {
  const { matriculaId, contaId, userId, body } = input;
  const currentMatricula = await matriculaRouteRepository.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: {
      id: true,
      planoId: true,
      comboId: true,
      asaasSubscriptionId: true,
      formaPagamentoTaxa: true,
      updatedAt: true,
      plano: { select: { valor: true } },
      combo: { select: { valor: true } },
      cobrancas: { select: { tipo: true, status: true, formaPagamento: true, valor: true, vencimento: true, updatedAt: true } },
    },
  });
  if (!currentMatricula) fail(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');

  const financialContext = await resolveMatriculaFinancialContext({ db: matriculaRouteRepository, matriculaId: currentMatricula.id, contaId });
  const targetSubscriptionId = financialContext?.asaasSubscriptionId ?? currentMatricula.asaasSubscriptionId ?? null;
  const nextPlanoId = body.planoId !== undefined ? body.planoId : currentMatricula.planoId;
  const nextComboId = body.comboId !== undefined ? body.comboId : currentMatricula.comboId;
  const productChanged = nextPlanoId !== currentMatricula.planoId || nextComboId !== currentMatricula.comboId;

  let financialMetadata: Record<string, unknown> | undefined;
  let nextSubscriptionValue: number | null = null;
  let nextSubscriptionCycle: ReturnType<typeof mapPeriodicidadeToCycle> | null = null;
  let pendingFamilyLocalUpdate: { value: number; cycle: ReturnType<typeof mapPeriodicidadeToCycle> } | null = null;
  let pendingCanonicalAllocationValues: Array<{ matriculaId: string; value: number }> | null = null;

  if (productChanged && targetSubscriptionId) {
    if (!financialContext) fail(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
    if (!isFinancialContextEditable(financialContext)) fail(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
    const nextPricing = await resolveProductPricing({ contaId, planoId: nextPlanoId, comboId: nextComboId });
    if (!nextPricing) fail(404, nextComboId ? 'COMBO_NAO_ENCONTRADO' : 'PLANO_NAO_ENCONTRADO', nextComboId ? 'Combo não encontrado para a conta informada.' : 'Plano não encontrado para a conta informada.');

    let remoteSubscription: Awaited<ReturnType<typeof getSubscription>>;
    try {
      remoteSubscription = await getSubscription(targetSubscriptionId, { contaId });
    } catch (error) {
      const classified = classifyAsaasSubscriptionMutationError(error);
      if (classified.kind === 'not_found' || classified.kind === 'not_editable') fail(409, 'ASSINATURA_NAO_EDITAVEL', classified.providerMessage ?? 'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.');
      if (classified.kind === 'unauthorized') fail(502, 'FINANCEIRO_AUTENTICACAO_INVALIDA', classified.providerMessage ?? 'A conta financeira rejeitou a operação.');
      throw error;
    }
    if (remoteSubscription.deleted || remoteSubscription.status === 'EXPIRED') {
      fail(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.');
    }

    if (financialContext.mode === 'FAMILY' && financialContext.family) {
      const pricing = await resolveFamilyPricing({ contaId, affectedMatriculaIds: financialContext.family.affectedMatriculaIds, editedMatriculaId: currentMatricula.id, editedPricing: nextPricing });
      if (!pricing.ok) fail(422, pricing.code, pricing.message);
      nextSubscriptionValue = pricing.value;
      nextSubscriptionCycle = pricing.cycle;
      pendingFamilyLocalUpdate = { value: pricing.value, cycle: pricing.cycle };
      pendingCanonicalAllocationValues = pricing.allocationValues;
    } else if (financialContext.sharedAgreement) {
      const pricing = await resolveSharedAgreementPricing({ contaId, agreementId: financialContext.sharedAgreement.id, editedMatriculaId: currentMatricula.id, editedPricing: nextPricing });
      if (!pricing.ok) fail(422, pricing.code, pricing.message);
      nextSubscriptionValue = pricing.value;
      nextSubscriptionCycle = pricing.cycle;
      pendingCanonicalAllocationValues = pricing.allocationValues;
    } else {
      nextSubscriptionValue = nextPricing.value;
      nextSubscriptionCycle = nextPricing.cycle;
      pendingCanonicalAllocationValues = [{ matriculaId: currentMatricula.id, value: nextPricing.value }];
    }

    const previousValue = typeof remoteSubscription.value === 'number' ? remoteSubscription.value : financialContext.localSnapshot?.value ?? null;
    const previousCycle = typeof remoteSubscription.cycle === 'string' && remoteSubscription.cycle.length > 0 ? remoteSubscription.cycle : null;
    const subscriptionPayload: Parameters<typeof updateSubscription>[1] = { updatePendingPayments: true };
    if (previousValue !== nextSubscriptionValue) subscriptionPayload.value = nextSubscriptionValue;
    if (nextSubscriptionCycle && previousCycle !== nextSubscriptionCycle) subscriptionPayload.cycle = nextSubscriptionCycle;
    if (subscriptionPayload.value !== undefined || subscriptionPayload.cycle !== undefined) {
      try {
        await updateSubscription(targetSubscriptionId, subscriptionPayload, { contaId });
      } catch (error) {
        const classified = classifyAsaasSubscriptionMutationError(error);
        if (classified.kind === 'not_found' || classified.kind === 'not_editable') fail(409, 'ASSINATURA_NAO_EDITAVEL', classified.providerMessage ?? 'O vínculo recorrente não pode ser atualizado porque está expirado ou removido na integração financeira.');
        if (classified.kind === 'unauthorized') fail(502, 'FINANCEIRO_AUTENTICACAO_INVALIDA', classified.providerMessage ?? 'A conta financeira rejeitou a operação.');
        throw error;
      }
    }
    financialMetadata = {
      subscriptionSync: {
        kind: 'PRODUCT_RECURRING_TERMS_UPDATED',
        mode: financialContext.mode,
        familyGroupId: financialContext.family?.id ?? null,
        affectedMatriculaIds: financialContext.family?.affectedMatriculaIds ?? financialContext.sharedAgreement?.affectedMatriculaIds ?? [currentMatricula.id],
        asaasSubscriptionId: targetSubscriptionId,
        productKind: nextPricing.kind,
        productId: nextPricing.id,
        productName: nextPricing.nome,
        previousValue,
        nextValue: nextSubscriptionValue,
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
    matriculaId,
    contaId,
    createdById: userId,
    turmaId: body.turmaId,
    comboId: body.comboId,
    planoId: body.planoId,
    motivo: body.motivo ?? undefined,
    metadata: financialMetadata,
  });
  if (targetSubscriptionId && nextSubscriptionValue != null && pendingCanonicalAllocationValues) {
    await projectConfirmedBillingAllocationValues({ contaId, asaasSubscriptionId: targetSubscriptionId, totalValue: nextSubscriptionValue, cycle: nextSubscriptionCycle, allocations: pendingCanonicalAllocationValues });
  }

  const localAlignment = pendingFamilyLocalUpdate && financialContext
    ? await updateFamilyFinancialLocalState({ db: matriculaRouteRepository, context: financialContext, value: pendingFamilyLocalUpdate.value, cycle: pendingFamilyLocalUpdate.cycle })
    : financialMetadata && pendingCanonicalAllocationValues
      ? await Promise.all(pendingCanonicalAllocationValues.map((allocation) => alignLocalPendingEnrollmentCharges({ db: matriculaRouteRepository, matriculaId: allocation.matriculaId, contaId, value: allocation.value }))).then((results) => ({ cobrancasUpdated: results.reduce((sum, result) => sum + result.cobrancasUpdated, 0), chargesUpdated: results.reduce((sum, result) => sum + result.chargesUpdated, 0), matriculasUpdated: results.length }))
      : null;

  return {
    payload: {
      ...mapEditMatriculaResultToDTO(matricula as unknown as Record<string, unknown>),
      asyncSync: financialMetadata ? {
        provider: 'ASAAS',
        fields: [
          ...(nextSubscriptionValue !== null ? ['value'] : []),
          ...(nextSubscriptionCycle ? ['cycle'] : []),
          'updatePendingPayments',
        ],
        ...(nextSubscriptionCycle ? { cycle: nextSubscriptionCycle } : {}),
        localAlignment,
        message: 'A troca de plano ou combo também atualizou a assinatura recorrente para manter coerência com os próximos ciclos financeiros.',
      } : null,
    },
  };
}
