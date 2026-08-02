import type {
  BillingAgreementChangePreview as FinanceBillingAgreementChangePreview,
  BillingAgreementChangeResult as FinanceBillingAgreementChangeResult,
  BillingAgreementView as FinanceBillingAgreementView,
  BillingChargeImpactAction,
  EffectivePolicy as FinanceEffectivePolicy,
  ProposedBillingAdjustment,
} from '@alusa/finance/billing-agreements/types';

import type {
  BillingAffectedPayment,
  BillingAgreementCommitResponse,
  BillingAgreementOperationView,
  BillingAgreementPreviewResponse,
  BillingAgreementView,
  BillingEffectivePolicy,
  BillingPaidPaymentAdjustment,
} from '@/features/cadastro/matriculas/billing-agreements/contracts';

export function toFinanceEffectivePolicy(policy: BillingEffectivePolicy): FinanceEffectivePolicy {
  if (policy === 'CURRENT_CYCLE') return 'CURRENT_CYCLE_FULL';
  if (policy === 'PRORATA') return 'CURRENT_CYCLE_PRORATED';
  return 'NEXT_CYCLE';
}

export function fromFinanceEffectivePolicy(policy: FinanceEffectivePolicy): BillingEffectivePolicy {
  if (policy === 'CURRENT_CYCLE_FULL') return 'CURRENT_CYCLE';
  if (policy === 'CURRENT_CYCLE_PRORATED') return 'PRORATA';
  return 'NEXT_CYCLE';
}

export function toFinanceProrationPolicy(policy: BillingEffectivePolicy) {
  if (policy === 'CURRENT_CYCLE') return 'FULL_CURRENT_CYCLE' as const;
  if (policy === 'PRORATA') return 'DAILY_CURRENT_CYCLE' as const;
  return 'NEXT_CYCLE' as const;
}

function toPublicChargeAction(action: BillingChargeImpactAction): BillingAffectedPayment['action'] {
  if (action === 'UPDATE_WITH_SUBSCRIPTION' || action === 'UPDATE_PAYMENT') return 'UPDATE';
  if (action === 'CANCEL_PENDING') return 'DELETE';
  if (action === 'CREATE_CREDIT') return 'CREDIT';
  if (action === 'CREATE_COMPLEMENT' || action === 'CREATE_PAYMENT') return 'COMPLEMENT';
  if (action === 'MANUAL_REVIEW') return 'REFUND_REVIEW';
  return 'UNCHANGED';
}

function adjustmentDescription(adjustment: ProposedBillingAdjustment) {
  if (adjustment.type === 'CREDIT') {
    return 'Crédito a ser aplicado em uma cobrança futura, sem alterar a cobrança já paga.';
  }
  if (adjustment.type === 'COMPLEMENT') {
    return 'Cobrança complementar necessária para ajustar o período.';
  }
  if (adjustment.type === 'REFUND') {
    return 'Reembolso sujeito à elegibilidade do meio de pagamento e à confirmação financeira.';
  }
  return 'Ajuste encaminhado para conferência manual do financeiro.';
}

function toPublicAdjustment(adjustment: ProposedBillingAdjustment): BillingPaidPaymentAdjustment {
  return {
    paymentId: adjustment.chargeId ?? `agreement:${adjustment.agreementId}`,
    amountCents: adjustment.amountCents,
    kind:
      adjustment.type === 'CREDIT'
        ? 'CREDIT'
        : adjustment.type === 'COMPLEMENT'
          ? 'COMPLEMENT'
          : 'REFUND_REVIEW',
    description: adjustmentDescription(adjustment),
  };
}

export function mapFinancePreview(
  preview: FinanceBillingAgreementChangePreview,
): BillingAgreementPreviewResponse {
  const affectedPayments = new Map<string, BillingAffectedPayment>();
  preview.plans.forEach((plan) => {
    plan.chargeImpacts.forEach((impact) => {
      const action = toPublicChargeAction(impact.action);
      if (action === 'UNCHANGED' || action === 'CREDIT' || action === 'REFUND_REVIEW') return;
      affectedPayments.set(impact.chargeId, {
        id: impact.chargeId,
        dueDate: impact.dueDate,
        status: impact.status,
        currentAmountCents: impact.amountCents,
        resultingAmountCents:
          impact.targetAmountCents ??
          (impact.action === 'CANCEL_PENDING' ? 0 : impact.amountCents),
        action,
      });
    });
  });

  return {
    agreementId: preview.agreementId,
    operation: preview.kind,
    effectivePolicy: fromFinanceEffectivePolicy(preview.effectivePolicy),
    sourceVersion: preview.sourceVersion,
    previewHash: preview.previewHash,
    expiresAt: preview.expiresAt,
    totals: {
      currentCents: preview.currentAmountCents,
      addedCents: preview.addedAmountCents,
      removedCents: preview.removedAmountCents,
      resultingCents: preview.resultingAmountCents,
    },
    affectedPendingPayments: [...affectedPayments.values()],
    paidPaymentAdjustments: preview.adjustments.map(toPublicAdjustment),
    warnings: preview.warnings,
    blockers: preview.blockers,
    canCommit: preview.blockers.length === 0,
  };
}

export function mapFinanceCommitResult(
  result: FinanceBillingAgreementChangeResult,
  acceptedAt = new Date(),
): BillingAgreementCommitResponse {
  const needsReconciliation = result.status === 'REQUIRES_RECONCILIATION';
  const agreementId = result.agreementIds[0];
  if (!agreementId) {
    throw new Error('Resultado financeiro sem acordo associado.');
  }
  return {
    operationId: result.operationId,
    agreementId,
    status: needsReconciliation ? 'REQUIRES_RECONCILIATION' : 'APPLIED',
    acceptedAt: acceptedAt.toISOString(),
    message: needsReconciliation
      ? 'A alteração foi registrada e será conferida pela reconciliação financeira.'
      : 'A alteração foi aplicada e confirmada no acordo financeiro.',
  };
}

function allocationDescription(kind: string) {
  if (kind === 'ENROLLMENT_FEE') return 'Taxa de matrícula';
  if (kind === 'MATERIAL') return 'Material';
  if (kind === 'ADJUSTMENT') return 'Ajuste';
  return 'Mensalidade';
}

export function mapFinanceAgreementView(input: {
  view: FinanceBillingAgreementView;
  payerName: string;
  studentNames: ReadonlyMap<string, string>;
  recentOperations?: BillingAgreementOperationView[];
}): BillingAgreementView {
  const { agreement, allocations, charges } = input.view;
  const pausedAndConfirmed =
    agreement.status === 'INACTIVE' && agreement.remoteStatus === 'INACTIVE';
  const cancelledAndConfirmed =
    agreement.status === 'CANCELLED' &&
    ['DELETED', 'INACTIVE', 'EXPIRED'].includes(agreement.remoteStatus ?? '');
  const reconciliationStatus =
    agreement.status === 'REQUIRES_RECONCILIATION'
      ? 'RESULT_UNKNOWN'
      : input.view.hasLocalDivergence
        ? 'DIVERGENT'
        : pausedAndConfirmed || cancelledAndConfirmed
          ? 'CONSISTENT'
          : agreement.desiredAmountCents !== agreement.confirmedAmountCents
          ? 'PENDING'
          : 'CONSISTENT';

  return {
    id: agreement.id,
    status: agreement.status,
    version: agreement.version,
    payer: {
      type: agreement.payer.type,
      id: agreement.payer.id,
      name: input.payerName,
    },
    billingType: agreement.billingType,
    cycle: agreement.cycle,
    dueDay: agreement.dueDay,
    desiredValueCents: agreement.desiredAmountCents,
    confirmedValueCents: agreement.confirmedAmountCents,
    reconciliationStatus,
    allocations: allocations.map((allocation) => ({
      id: allocation.id,
      matriculaId: allocation.enrollmentId,
      alunoId: allocation.studentId,
      alunoNome: input.studentNames.get(allocation.studentId) ?? 'Aluno',
      description: allocationDescription(allocation.kind),
      netAmountCents: allocation.netAmountCents,
      status: allocation.status === 'CANCELLED' ? 'CANCELED' : allocation.status,
      validFrom: allocation.validFrom,
      validUntil: allocation.validUntil,
    })),
    affectedPayments: charges.map((charge) => ({
      id: charge.id,
      dueDate: charge.dueDate,
      status: charge.status,
      currentAmountCents: charge.amountCents,
      resultingAmountCents: charge.amountCents,
      action: 'UNCHANGED',
    })),
    recentOperations: input.recentOperations ?? [],
    updatedAt: agreement.updatedAt,
  };
}
