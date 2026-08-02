export type BillingIntegritySeverity = 'HIGH' | 'MEDIUM';

export type BillingIntegrityIssueCode =
  | 'PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT'
  | 'ACTIVE_ALLOCATION_SUM_MISMATCH'
  | 'CONFIRMED_AMOUNT_MISMATCH'
  | 'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION'
  | 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT'
  | 'DUPLICATE_ACTIVE_ALLOCATION';

export type BillingIntegrityRepairKind =
  | 'MARK_ENROLLMENT_PARTIAL'
  | 'ALIGN_AGREEMENT_DESIRED_AMOUNT'
  | 'MARK_AGREEMENT_REQUIRES_RECONCILIATION'
  | 'CREATE_COMPLEMENT_ADJUSTMENT'
  | 'MANUAL_REVIEW';

export type BillingIntegrityEnrollment = {
  id: string;
  billingProvisionStatus: string;
  hasProvisionedOneTimeTuition?: boolean;
};

export type BillingIntegrityAllocation = {
  id: string;
  agreementId: string;
  enrollmentId: string;
  kind: string;
  status: string;
  recurring: boolean;
  netAmountCents: number;
  validFrom: string;
  validUntil: string | null;
};

export type BillingIntegrityCharge = {
  id: string;
  status: string;
  amountCents: number;
  dueDate: string;
};

export type BillingIntegrityAdjustment = {
  id: string;
  type: string;
  status: string;
  amountCents: number;
  effectiveDate: string;
  chargeId: string | null;
};

export type BillingIntegrityAgreement = {
  id: string;
  status: string;
  desiredAmountCents: number;
  confirmedAmountCents: number;
  asaasSubscriptionId: string | null;
  remoteStatus: string | null;
  allocations: BillingIntegrityAllocation[];
  charges: BillingIntegrityCharge[];
  adjustments: BillingIntegrityAdjustment[];
};

export type BillingIntegritySnapshot = {
  contaId: string;
  enrollments: BillingIntegrityEnrollment[];
  agreements: BillingIntegrityAgreement[];
};

export type BillingIntegrityRepairAction = {
  id: string;
  kind: BillingIntegrityRepairKind;
  issueCode: BillingIntegrityIssueCode;
  agreementId: string | null;
  enrollmentId: string | null;
  amountCents: number | null;
  effectiveDate: string | null;
  chargeId?: string | null;
  automatic: boolean;
  reason: string;
};

export type BillingIntegrityIssue = {
  id: string;
  code: BillingIntegrityIssueCode;
  severity: BillingIntegritySeverity;
  agreementId: string | null;
  enrollmentId: string | null;
  details: Record<string, string | number | boolean | null>;
  repairActionIds: string[];
};

export type BillingIntegrityAudit = {
  contaId: string;
  auditedAt: string;
  issues: BillingIntegrityIssue[];
  repairPlan: BillingIntegrityRepairAction[];
};

export type BillingIntegrityRepairResult = {
  actionId: string;
  kind: BillingIntegrityRepairKind;
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'SKIPPED_MANUAL';
};

export interface BillingIntegrityRepository {
  loadSnapshot(_input: { contaId: string }): Promise<BillingIntegritySnapshot>;
  applyRepair(_input: {
    contaId: string;
    action: BillingIntegrityRepairAction;
  }): Promise<'APPLIED' | 'ALREADY_APPLIED'>;
}

const PAID_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'PAID', 'PAGO']);
const LIVE_ADJUSTMENT_STATUSES = new Set(['PENDING', 'PROCESSING', 'APPLIED']);
const CONSISTENT_AGREEMENT_STATUSES = new Set(['ACTIVE', 'PENDING_PROVISION']);
const TERMINAL_ALLOCATION_STATUSES = new Set(['ENDED', 'CANCELLED']);
const TERMINAL_REMOTE_AGREEMENT_STATUSES = new Set(['EXPIRED', 'DELETED', 'INACTIVE']);

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isEffectiveAt(allocation: BillingIntegrityAllocation, date: string): boolean {
  return (
    !TERMINAL_ALLOCATION_STATUSES.has(allocation.status) &&
    allocation.validFrom <= date &&
    (allocation.validUntil === null || allocation.validUntil > date)
  );
}

function isCurrentOrFuture(allocation: BillingIntegrityAllocation, date: string): boolean {
  return (
    !TERMINAL_ALLOCATION_STATUSES.has(allocation.status) &&
    (allocation.validUntil === null || allocation.validUntil > date)
  );
}

function recurringAmountAt(agreement: BillingIntegrityAgreement, date: string): number {
  return agreement.allocations
    .filter((allocation) => allocation.recurring && isEffectiveAt(allocation, date))
    .reduce((sum, allocation) => sum + allocation.netAmountCents, 0);
}

function keyPart(value: string | null): string {
  return value ?? 'none';
}

function issueId(code: BillingIntegrityIssueCode, agreementId: string | null, enrollmentId: string | null, suffix = '') {
  return [code, keyPart(agreementId), keyPart(enrollmentId), suffix].filter(Boolean).join(':');
}

function actionId(kind: BillingIntegrityRepairKind, issue: string, suffix = '') {
  return [kind, issue, suffix].filter(Boolean).join(':');
}

/**
 * Audita somente o snapshot local. Datas de fim são tratadas como exclusivas,
 * assim como no motor canônico de BillingAgreement.
 */
export function analyzeBillingAgreementIntegrity(
  snapshot: BillingIntegritySnapshot,
  input?: { now?: Date },
): BillingIntegrityAudit {
  const now = input?.now ?? new Date();
  const today = dateOnly(now);
  const lowerPaidWindow = dateOnly(new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000));
  const upperPaidWindow = dateOnly(new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000));
  const issues: BillingIntegrityIssue[] = [];
  const repairs = new Map<string, BillingIntegrityRepairAction>();

  const addAction = (action: BillingIntegrityRepairAction) => {
    repairs.set(action.id, action);
    return action.id;
  };

  const agreementsByEnrollment = new Map<string, BillingIntegrityAgreement[]>();
  for (const agreement of snapshot.agreements) {
    for (const allocation of agreement.allocations) {
      const current = agreementsByEnrollment.get(allocation.enrollmentId) ?? [];
      if (!current.some((item) => item.id === agreement.id)) current.push(agreement);
      agreementsByEnrollment.set(allocation.enrollmentId, current);
    }
  }

  for (const enrollment of snapshot.enrollments) {
    if (enrollment.billingProvisionStatus !== 'PROVISIONADO') continue;
    const agreements = agreementsByEnrollment.get(enrollment.id) ?? [];
    const consistent = enrollment.hasProvisionedOneTimeTuition === true || agreements.some((agreement) =>
      CONSISTENT_AGREEMENT_STATUSES.has(agreement.status) &&
      Boolean(agreement.asaasSubscriptionId) &&
      !TERMINAL_REMOTE_AGREEMENT_STATUSES.has(agreement.remoteStatus ?? '') &&
      agreement.confirmedAmountCents === agreement.desiredAmountCents &&
      agreement.allocations.some((allocation) =>
        allocation.enrollmentId === enrollment.id &&
        allocation.kind === 'TUITION' &&
        allocation.recurring &&
        isCurrentOrFuture(allocation, today),
      ),
    );
    if (consistent) continue;
    const id = issueId('PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT', null, enrollment.id);
    const repairActionIds = [addAction({
      id: actionId('MARK_ENROLLMENT_PARTIAL', id),
      kind: 'MARK_ENROLLMENT_PARTIAL',
      issueCode: 'PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT',
      agreementId: null,
      enrollmentId: enrollment.id,
      amountCents: null,
      effectiveDate: null,
      automatic: true,
      reason: 'Matrícula marcada como provisionada sem acordo e alocação recorrente confirmados.',
    })];
    issues.push({
      id,
      code: 'PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT',
      severity: 'HIGH',
      agreementId: null,
      enrollmentId: enrollment.id,
      details: { candidateAgreementCount: agreements.length },
      repairActionIds,
    });
  }

  for (const agreement of snapshot.agreements) {
    // Acordos cancelados são históricos imutáveis; a matrícula provisionada
    // vinculada a eles já é tratada pela invariante acima.
    if (agreement.status === 'CANCELLED') continue;
    const activeAmountCents = recurringAmountAt(agreement, today);
    const activeLogicalKeys = agreement.allocations
      .filter((allocation) => allocation.recurring && isEffectiveAt(allocation, today))
      .map((allocation) => `${allocation.enrollmentId}:${allocation.kind}`);
    const hasDuplicateActiveAllocation = new Set(activeLogicalKeys).size !== activeLogicalKeys.length;
    const hasFutureScheduledAllocation = agreement.allocations.some((allocation) =>
      allocation.recurring && allocation.validFrom > today && isCurrentOrFuture(allocation, today),
    );
    if (activeAmountCents !== agreement.desiredAmountCents) {
      const id = issueId('ACTIVE_ALLOCATION_SUM_MISMATCH', agreement.id, null);
      const canAlignAutomatically = !hasDuplicateActiveAllocation && !hasFutureScheduledAllocation;
      const repairActionIds = [
        addAction({
          id: actionId(
            canAlignAutomatically ? 'ALIGN_AGREEMENT_DESIRED_AMOUNT' : 'MANUAL_REVIEW',
            id,
            String(activeAmountCents),
          ),
          kind: canAlignAutomatically ? 'ALIGN_AGREEMENT_DESIRED_AMOUNT' : 'MANUAL_REVIEW',
          issueCode: 'ACTIVE_ALLOCATION_SUM_MISMATCH',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: activeAmountCents,
          effectiveDate: today,
          automatic: canAlignAutomatically,
          reason: canAlignAutomatically
            ? 'Alinha o valor desejado local à soma não ambígua das alocações recorrentes vigentes.'
            : 'Alocações duplicadas ou futuras tornam o valor correto ambíguo; requer decisão operacional.',
        }),
        addAction({
          id: actionId('MARK_AGREEMENT_REQUIRES_RECONCILIATION', id),
          kind: 'MARK_AGREEMENT_REQUIRES_RECONCILIATION',
          issueCode: 'ACTIVE_ALLOCATION_SUM_MISMATCH',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: null,
          effectiveDate: null,
          automatic: true,
          reason: 'O valor remoto confirmado não deve ser presumido após corrigir a projeção local.',
        }),
      ];
      issues.push({
        id,
        code: 'ACTIVE_ALLOCATION_SUM_MISMATCH',
        severity: 'HIGH',
        agreementId: agreement.id,
        enrollmentId: null,
        details: { desiredAmountCents: agreement.desiredAmountCents, activeAllocationAmountCents: activeAmountCents },
        repairActionIds,
      });
    }

    if (agreement.status === 'ACTIVE' && agreement.confirmedAmountCents !== agreement.desiredAmountCents) {
      const id = issueId('CONFIRMED_AMOUNT_MISMATCH', agreement.id, null);
      const repairActionIds = [addAction({
        id: actionId('MARK_AGREEMENT_REQUIRES_RECONCILIATION', id),
        kind: 'MARK_AGREEMENT_REQUIRES_RECONCILIATION',
        issueCode: 'CONFIRMED_AMOUNT_MISMATCH',
        agreementId: agreement.id,
        enrollmentId: null,
        amountCents: null,
        effectiveDate: null,
        automatic: true,
        reason: 'Valor confirmado diverge do desejado; exige convergência pelo fluxo financeiro oficial.',
      })];
      issues.push({
        id,
        code: 'CONFIRMED_AMOUNT_MISMATCH',
        severity: 'HIGH',
        agreementId: agreement.id,
        enrollmentId: null,
        details: { desiredAmountCents: agreement.desiredAmountCents, confirmedAmountCents: agreement.confirmedAmountCents },
        repairActionIds,
      });
    }

    const futureAllocations = agreement.allocations.filter((allocation) =>
      allocation.recurring && isCurrentOrFuture(allocation, today),
    );
    if (
      (agreement.remoteStatus === 'EXPIRED' || agreement.remoteStatus === 'DELETED') &&
      futureAllocations.length > 0
    ) {
      const id = issueId('EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION', agreement.id, null);
      const repairActionIds = [
        addAction({
          id: actionId('MARK_AGREEMENT_REQUIRES_RECONCILIATION', id),
          kind: 'MARK_AGREEMENT_REQUIRES_RECONCILIATION',
          issueCode: 'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: null,
          effectiveDate: null,
          automatic: true,
          reason: 'Assinatura inativa/expirada ainda possui obrigação recorrente futura.',
        }),
        addAction({
          id: actionId('MANUAL_REVIEW', id),
          kind: 'MANUAL_REVIEW',
          issueCode: 'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: null,
          effectiveDate: today,
          automatic: false,
          reason: 'Reativar ou substituir assinatura requer preflight e confirmação remota.',
        }),
      ];
      issues.push({
        id,
        code: 'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION',
        severity: 'HIGH',
        agreementId: agreement.id,
        enrollmentId: null,
        details: { remoteStatus: agreement.remoteStatus, futureAllocationCount: futureAllocations.length },
        repairActionIds,
      });
    }

    const effectiveAllocations = agreement.allocations.filter((allocation) =>
      allocation.recurring && isEffectiveAt(allocation, today),
    );
    const duplicateGroups = new Map<string, BillingIntegrityAllocation[]>();
    for (const allocation of effectiveAllocations) {
      const key = `${allocation.enrollmentId}:${allocation.kind}`;
      const group = duplicateGroups.get(key) ?? [];
      group.push(allocation);
      duplicateGroups.set(key, group);
    }
    for (const [key, group] of duplicateGroups) {
      if (group.length < 2) continue;
      const enrollmentId = group[0]?.enrollmentId ?? null;
      const id = issueId('DUPLICATE_ACTIVE_ALLOCATION', agreement.id, enrollmentId, key);
      const repairActionIds = [
        addAction({
          id: actionId('MARK_AGREEMENT_REQUIRES_RECONCILIATION', id),
          kind: 'MARK_AGREEMENT_REQUIRES_RECONCILIATION',
          issueCode: 'DUPLICATE_ACTIVE_ALLOCATION',
          agreementId: agreement.id,
          enrollmentId,
          amountCents: null,
          effectiveDate: null,
          automatic: true,
          reason: 'Alocações sobrepostas podem duplicar a mensalidade calculada.',
        }),
        addAction({
          id: actionId('MANUAL_REVIEW', id),
          kind: 'MANUAL_REVIEW',
          issueCode: 'DUPLICATE_ACTIVE_ALLOCATION',
          agreementId: agreement.id,
          enrollmentId,
          amountCents: null,
          effectiveDate: today,
          automatic: false,
          reason: 'Encerrar uma alocação exige identificar qual registro representa a intenção operacional.',
        }),
      ];
      issues.push({
        id,
        code: 'DUPLICATE_ACTIVE_ALLOCATION',
        severity: 'HIGH',
        agreementId: agreement.id,
        enrollmentId,
        details: { duplicateCount: group.length, allocationIds: group.map((item) => item.id).join(',') },
        repairActionIds,
      });
    }

    for (const charge of agreement.charges) {
      if (
        !PAID_STATUSES.has(charge.status) ||
        charge.dueDate < lowerPaidWindow ||
        charge.dueDate > upperPaidWindow
      ) continue;
      // Matrículas curtas podem terminar antes do vencimento da cobrança do
      // ciclo. Nesse caso, o valor vigente hoje ainda compõe o ciclo pago.
      const targetAmountCents = Math.max(
        recurringAmountAt(agreement, today),
        recurringAmountAt(agreement, charge.dueDate),
      );
      if (targetAmountCents <= charge.amountCents) continue;
      const existingComplementsCents = agreement.adjustments
        .filter((adjustment) =>
          adjustment.type === 'COMPLEMENT' &&
          LIVE_ADJUSTMENT_STATUSES.has(adjustment.status) &&
          adjustment.chargeId === charge.id,
        )
        .reduce((sum, adjustment) => sum + adjustment.amountCents, 0);
      const missingAmountCents = targetAmountCents - charge.amountCents - existingComplementsCents;
      if (missingAmountCents <= 0) continue;
      const id = issueId('PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT', agreement.id, null, charge.id);
      const canCreateComplement = !hasDuplicateActiveAllocation;
      const repairActionIds = [
        addAction({
          id: actionId(
            canCreateComplement ? 'CREATE_COMPLEMENT_ADJUSTMENT' : 'MANUAL_REVIEW',
            id,
            String(missingAmountCents),
          ),
          kind: canCreateComplement ? 'CREATE_COMPLEMENT_ADJUSTMENT' : 'MANUAL_REVIEW',
          issueCode: 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: missingAmountCents,
          effectiveDate: charge.dueDate < today ? today : charge.dueDate,
          chargeId: charge.id,
          automatic: canCreateComplement,
          reason: canCreateComplement
            ? 'Enfileira apenas o delta não coberto; o worker financeiro fará a integração idempotente.'
            : 'O delta depende de alocações duplicadas e não pode ser cobrado automaticamente.',
        }),
        addAction({
          id: actionId('MARK_AGREEMENT_REQUIRES_RECONCILIATION', id),
          kind: 'MARK_AGREEMENT_REQUIRES_RECONCILIATION',
          issueCode: 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
          agreementId: agreement.id,
          enrollmentId: null,
          amountCents: null,
          effectiveDate: null,
          automatic: true,
          reason: 'O ciclo pago ficou abaixo da soma das alocações vigentes.',
        }),
      ];
      issues.push({
        id,
        code: 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
        severity: 'HIGH',
        agreementId: agreement.id,
        enrollmentId: null,
        details: {
          chargeId: charge.id,
          paidAmountCents: charge.amountCents,
          targetAmountCents,
          existingComplementsCents,
          missingAmountCents,
        },
        repairActionIds,
      });
    }
  }

  return {
    contaId: snapshot.contaId,
    auditedAt: now.toISOString(),
    issues,
    repairPlan: [...repairs.values()],
  };
}

export async function reconcileBillingAgreementIntegrity(input: {
  contaId: string;
  repository: BillingIntegrityRepository;
  now?: Date;
  dryRun?: boolean;
  actionIds?: string[];
}): Promise<BillingIntegrityAudit & { dryRun: boolean; results: BillingIntegrityRepairResult[] }> {
  if (!input.contaId.trim()) throw new Error('contaId é obrigatório para reconciliar BillingAgreement.');
  const dryRun = input.dryRun ?? true;
  if (!dryRun && (!input.actionIds || input.actionIds.length === 0)) {
    throw new Error('Execução exige actionIds explícitos; dry-run é o padrão seguro.');
  }
  const snapshot = await input.repository.loadSnapshot({ contaId: input.contaId });
  if (snapshot.contaId !== input.contaId) throw new Error('Snapshot retornado fora do tenant solicitado.');
  const audit = analyzeBillingAgreementIntegrity(snapshot, { now: input.now });
  if (dryRun) return { ...audit, dryRun, results: [] };

  const selectedIds = new Set(input.actionIds);
  const knownIds = new Set(audit.repairPlan.map((action) => action.id));
  const unknown = [...selectedIds].filter((id) => !knownIds.has(id));
  if (unknown.length > 0) throw new Error(`Ações não pertencem ao plano atual: ${unknown.join(', ')}`);

  const results: BillingIntegrityRepairResult[] = [];
  for (const action of audit.repairPlan) {
    if (!selectedIds.has(action.id)) continue;
    if (!action.automatic) {
      results.push({ actionId: action.id, kind: action.kind, outcome: 'SKIPPED_MANUAL' });
      continue;
    }
    const outcome = await input.repository.applyRepair({ contaId: input.contaId, action });
    results.push({ actionId: action.id, kind: action.kind, outcome });
  }
  return { ...audit, dryRun, results };
}
