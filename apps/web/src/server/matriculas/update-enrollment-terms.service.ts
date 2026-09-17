import {
  getSubscription,
  projectConfirmedBillingAgreementSnapshot,
  updateSubscription,
} from '@alusa/finance';
import type { UpdateMatriculaJurosMultaInputDTO } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaSubscriptionTermsUpdateResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';
import {
  alignLocalPendingEnrollmentCharges,
  markEnrollmentFinanceDivergence,
} from './enrollment-finance-consistency.service';
import {
  isFinancialContextEditable,
  resolveMatriculaFinancialContext,
  updateFamilyFinancialLocalState,
} from './financial-context.service';
import { syncEditableSubscriptionPayments } from './subscription-pending-payments-sync';
import { matriculaRouteRepository } from './matricula-route.repository';

type AsaasTermsSnapshot = {
  interest?: { value?: number | null } | null;
  fine?: { value?: number | null; type?: string | null } | null;
  discount?: { value?: number | null; type?: string | null; dueDateLimitDays?: number | null } | null;
};

export type UpdateEnrollmentTermsResult =
  | { kind: 'SUCCESS'; data: Record<string, unknown> }
  | { kind: 'FAILURE'; status: 400 | 404 | 409 | 502; body: Record<string, unknown> };

function failure(
  status: UpdateEnrollmentTermsResult extends infer T
    ? T extends { kind: 'FAILURE'; status: infer S }
      ? S
      : never
    : never,
  code: string,
  message: string,
  details?: unknown,
): UpdateEnrollmentTermsResult {
  return { kind: 'FAILURE', status: status as 400 | 404 | 409 | 502, body: { error: { code, message, details } } };
}

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
  if (expected.interest && normalizeNumber(remote.interest?.value) !== normalizeNumber(expected.interest.value)) return false;
  if (expected.fine) {
    if (normalizeNumber(remote.fine?.value) !== normalizeNumber(expected.fine.value)) return false;
    if (expected.fine.type && normalizeAdjustmentType(remote.fine?.type) !== normalizeAdjustmentType(expected.fine.type)) return false;
  }
  if (expected.discount) {
    if (normalizeNumber(remote.discount?.value) !== normalizeNumber(expected.discount.value)) return false;
    if (expected.discount.type && normalizeAdjustmentType(remote.discount?.type) !== normalizeAdjustmentType(expected.discount.type)) return false;
    if (Number(remote.discount?.dueDateLimitDays ?? 0) !== Number(expected.discount.dueDateLimitDays ?? 0)) return false;
  }
  return true;
}

async function updateMatriculaSnapshot(params: {
  id: string;
  contaId: string;
  data: Record<string, unknown>;
}) {
  if (typeof matriculaRouteRepository.matricula.updateMany === 'function') {
    const result = await matriculaRouteRepository.matricula.updateMany({
      where: { id: params.id, contaId: params.contaId },
      data: params.data,
    });
    if (result?.count === 1 && typeof matriculaRouteRepository.matricula.findFirst === 'function') {
      const updated = await matriculaRouteRepository.matricula.findFirst({
        where: { id: params.id, contaId: params.contaId },
        select: {
          jurosMensal: true,
          jurosTipo: true,
          multaPercentual: true,
          multaTipo: true,
          descontoAntecipado: true,
          descontoTipo: true,
          prazoDesconto: true,
        },
      });
      if (updated) return updated;
    }
  }
  return matriculaRouteRepository.matricula.update({ where: { id: params.id }, data: params.data });
}

export async function updateEnrollmentTerms(params: {
  matriculaId: string;
  contaId: string;
  userId: string;
  input: UpdateMatriculaJurosMultaInputDTO;
}): Promise<UpdateEnrollmentTermsResult> {
  const { interest, fine, discount } = params.input;
  const matricula = await matriculaRouteRepository.matricula.findFirst({
    where: { id: params.matriculaId, contaId: params.contaId },
    select: { id: true, asaasSubscriptionId: true },
  });
  if (!matricula) return failure(404, 'NAO_ENCONTRADO', 'Matrícula não encontrada');

  const financialContext = await resolveMatriculaFinancialContext({
    db: matriculaRouteRepository,
    matriculaId: params.matriculaId,
    contaId: params.contaId,
  });
  const targetSubscriptionId = financialContext?.asaasSubscriptionId ?? matricula.asaasSubscriptionId;
  if (!financialContext || !targetSubscriptionId) {
    return failure(400, 'ASSINATURA_NAO_ENCONTRADA', 'Esta matrícula não possui vínculo financeiro ativo');
  }

  const localSubscription = await matriculaRouteRepository.subscription.findFirst({
    where: { contaId: params.contaId, matriculaId: matricula.id },
    select: { status: true },
  });
  if (!isFinancialContextEditable(financialContext)) {
    return failure(409, 'ASSINATURA_NAO_EDITAVEL', 'O vínculo recorrente não pode ser atualizado no momento.');
  }

  const asaasInterest = interest ? { value: interest.value as number } : undefined;
  const asaasFine = fine ? { value: fine.value as number, type: fine.type } : undefined;
  const asaasDiscount = discount
    ? { value: discount.value, type: discount.type, dueDateLimitDays: discount.dueDateLimitDays ?? 0 }
    : undefined;
  const asaasPayload = {
    ...(asaasInterest ? { interest: asaasInterest } : {}),
    ...(asaasFine ? { fine: asaasFine } : {}),
    ...(asaasDiscount ? { discount: asaasDiscount } : {}),
    updatePendingPayments: true,
  };

  try {
    const updatedRemote = await updateSubscription(targetSubscriptionId, asaasPayload, { contaId: params.contaId });
    const expectedTerms = {
      ...(asaasInterest ? { interest: asaasInterest } : {}),
      ...(asaasFine ? { fine: asaasFine } : {}),
      ...(asaasDiscount ? { discount: asaasDiscount } : {}),
    };
    const remoteTerms = termsMatchRemote(updatedRemote as AsaasTermsSnapshot, expectedTerms)
      ? updatedRemote
      : await getSubscription(targetSubscriptionId, { contaId: params.contaId });
    if (!termsMatchRemote(remoteTerms as AsaasTermsSnapshot, expectedTerms)) {
      return failure(502, 'ASAAS_TERMS_NOT_CONFIRMED', 'O Asaas aceitou a requisição, mas os termos financeiros retornados ainda não refletem a alteração. Tente novamente em instantes.', {
        expected: { interest: asaasInterest ?? null, fine: asaasFine ?? null, discount: asaasDiscount ?? null },
      });
    }
  } catch (error) {
    const classified = classifyAsaasSubscriptionMutationError(error);
    if (classified.kind === 'not_found' || classified.kind === 'not_editable') {
      return failure(409, 'ASSINATURA_NAO_EDITAVEL', classified.providerMessage ?? 'O vínculo recorrente não pode ser atualizado no momento.');
    }
    if (classified.kind === 'unauthorized') {
      return failure(502, 'FINANCEIRO_AUTENTICACAO_INVALIDA', classified.providerMessage ?? 'A conta financeira rejeitou a operação.');
    }
    throw error;
  }

  await projectConfirmedBillingAgreementSnapshot({
    contaId: params.contaId,
    asaasSubscriptionId: targetSubscriptionId,
    terms: {
      interestValue: asaasInterest?.value ?? null,
      interestType: asaasInterest ? 'PERCENTAGE' : null,
      fineValue: asaasFine?.value ?? null,
      fineType: asaasFine?.type ?? null,
      discountValue: asaasDiscount?.value ?? null,
      discountType: asaasDiscount?.type ?? null,
      discountDueDateLimitDays: asaasDiscount?.dueDateLimitDays ?? null,
    },
  });

  const remotePaymentsAlignment = await syncEditableSubscriptionPayments({
    contaId: params.contaId,
    asaasSubscriptionId: targetSubscriptionId,
    terms: { interest: asaasInterest ?? null, fine: asaasFine ?? null, discount: asaasDiscount ?? null },
  });
  if (remotePaymentsAlignment.failed > 0) {
    await markEnrollmentFinanceDivergence({
      contaId: params.contaId,
      matriculaId: params.matriculaId,
      asaasSubscriptionId: targetSubscriptionId,
      issue: 'PAYMENT_STATUS_DRIFT',
      severity: 'HIGH',
      localStatus: 'PENDING_SYNC',
      remoteStatus: 'PARTIAL_FAILURE',
      metadata: { operation: 'SUBSCRIPTION_TERMS_UPDATE', mode: financialContext.mode, familyGroupId: financialContext.family?.id ?? null, remotePaymentsAlignment },
    });
    return failure(502, 'COBRANCAS_PENDENTES_NAO_ALINHADAS', 'A assinatura foi atualizada, mas uma ou mais cobranças pendentes não puderam ser alinhadas. A operação foi registrada para reconciliação.', { remotePaymentsAlignment });
  }

  const updateData = {
    jurosMensal: interest?.value ?? null,
    jurosTipo: interest ? 'PERCENTAGE' : null,
    multaPercentual: fine?.value ?? null,
    multaTipo: fine?.type ?? null,
    descontoAntecipado: discount && discount.value > 0 ? discount.value : null,
    descontoTipo: discount && discount.value > 0 ? discount.type ?? null : null,
    prazoDesconto: discount && discount.value > 0 ? discount.dueDateLimitDays ?? null : null,
  };
  const updatedMatricula = await updateMatriculaSnapshot({
    id: financialContext.mode === 'FAMILY' ? financialContext.sourceMatriculaId : params.matriculaId,
    contaId: params.contaId,
    data: updateData,
  });
  const affectedMatriculaIds = financialContext.mode === 'FAMILY'
    ? financialContext.family?.affectedMatriculaIds ?? []
    : financialContext.sharedAgreement?.affectedMatriculaIds ?? [];
  if (affectedMatriculaIds.length > 0) {
    await matriculaRouteRepository.matricula.updateMany({
      where: { contaId: params.contaId, id: { in: affectedMatriculaIds } },
      data: updateData,
    });
  }

  await matriculaRouteRepository.matriculaLog.create({
    data: {
      matriculaId: params.matriculaId,
      actorId: params.userId,
      action: 'MATRICULA_SUBSCRIPTION_TERMS_UPDATED',
      metadata: {
        asaasSubscriptionId: targetSubscriptionId,
        mode: financialContext.mode,
        familyGroupId: financialContext.family?.id ?? null,
        affectedMatriculaIds: affectedMatriculaIds.length > 0 ? affectedMatriculaIds : [params.matriculaId],
        previousSubscriptionStatus: localSubscription?.status ?? 'UNKNOWN',
        interest: asaasInterest ? { ...asaasInterest, type: 'PERCENTAGE' } : null,
        fine,
        discount: asaasDiscount ?? null,
        updatePendingPayments: true,
      },
    },
  });

  const localAlignment = financialContext.mode === 'FAMILY'
    ? await updateFamilyFinancialLocalState({
        db: matriculaRouteRepository,
        context: financialContext,
        interest: interest ? { value: interest.value } : null,
        fine: fine ? { value: fine.value, type: fine.type ?? 'PERCENTAGE' } : null,
        discount: discount ? { value: discount.value, type: discount.type ?? 'FIXED', dueDateLimitDays: discount.dueDateLimitDays ?? 0 } : null,
      })
    : await alignLocalPendingEnrollmentCharges({
        db: matriculaRouteRepository,
        matriculaId: params.matriculaId,
        contaId: params.contaId,
        interest: interest ? { value: interest.value, type: 'PERCENTAGE' } : null,
        fine: fine ? { value: fine.value, type: fine.type ?? 'PERCENTAGE' } : null,
        discount: discount ? { value: discount.value, type: discount.type ?? 'FIXED', dueDateLimitDays: discount.dueDateLimitDays ?? 0 } : null,
      });

  return {
    kind: 'SUCCESS' as const,
    data: {
      ...mapMatriculaSubscriptionTermsUpdateResultToDTO({
        interest,
        fine,
        discount,
        updated: {
          jurosMensal: updatedMatricula.jurosMensal ? Number(updatedMatricula.jurosMensal) : null,
          jurosTipo: updatedMatricula.jurosTipo ?? null,
          multaPercentual: updatedMatricula.multaPercentual ? Number(updatedMatricula.multaPercentual) : null,
          multaTipo: updatedMatricula.multaTipo ?? null,
          descontoAntecipado: updatedMatricula.descontoAntecipado ? Number(updatedMatricula.descontoAntecipado) : null,
          descontoTipo: updatedMatricula.descontoTipo ?? null,
          prazoDesconto: updatedMatricula.prazoDesconto ?? null,
        },
        message: 'Juros, multa e desconto atualizados com sucesso',
      }),
      asyncSync: {
        provider: 'ASAAS',
        fields: ['interest', 'fine', 'discount', 'updatePendingPayments', 'pendingPayments'],
        remotePaymentsAlignment,
        localAlignment,
      },
    },
  };
}
