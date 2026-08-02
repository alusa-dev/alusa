import { describe, expect, it, vi } from 'vitest';

import {
  analyzeBillingAgreementIntegrity,
  reconcileBillingAgreementIntegrity,
  type BillingIntegrityRepository,
  type BillingIntegritySnapshot,
} from './reconciliation';

const NOW = new Date('2026-07-31T12:00:00.000Z');

function snapshot(overrides?: Partial<BillingIntegritySnapshot>): BillingIntegritySnapshot {
  return {
    contaId: 'conta-1',
    enrollments: [],
    agreements: [],
    ...overrides,
  };
}

function agreement() {
  return {
    id: 'agreement-1',
    status: 'ACTIVE',
    desiredAmountCents: 15_000,
    confirmedAmountCents: 15_000,
    asaasSubscriptionId: 'sub-1',
    remoteStatus: 'EXPIRED',
    allocations: [
      {
        id: 'allocation-1',
        agreementId: 'agreement-1',
        enrollmentId: 'enrollment-2',
        kind: 'TUITION',
        status: 'ACTIVE',
        recurring: true,
        netAmountCents: 15_000,
        validFrom: '2026-07-30',
        validUntil: '2026-08-05',
      },
      {
        id: 'allocation-2',
        agreementId: 'agreement-1',
        enrollmentId: 'enrollment-1',
        kind: 'TUITION',
        status: 'ACTIVE',
        recurring: true,
        netAmountCents: 15_000,
        validFrom: '2026-07-30',
        validUntil: '2026-08-05',
      },
    ],
    charges: [{
      id: 'charge-1',
      status: 'CONFIRMED',
      amountCents: 15_000,
      dueDate: '2026-08-05',
    }],
    adjustments: [],
  };
}

describe('analyzeBillingAgreementIntegrity', () => {
  it('detecta as invariantes críticas e calcula complemento somente pelo delta descoberto', () => {
    const audit = analyzeBillingAgreementIntegrity(snapshot({
      enrollments: [{ id: 'enrollment-1', billingProvisionStatus: 'PROVISIONADO' }],
      agreements: [agreement()],
    }), { now: NOW });

    expect(audit.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT',
      'ACTIVE_ALLOCATION_SUM_MISMATCH',
      'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION',
      'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
    ]));
    expect(audit.repairPlan).toContainEqual(expect.objectContaining({
      kind: 'ALIGN_AGREEMENT_DESIRED_AMOUNT',
      amountCents: 30_000,
    }));
    expect(audit.repairPlan).toContainEqual(expect.objectContaining({
      kind: 'CREATE_COMPLEMENT_ADJUSTMENT',
      amountCents: 15_000,
      effectiveDate: '2026-08-05',
      chargeId: 'charge-1',
    }));
    expect(audit.repairPlan).toContainEqual(expect.objectContaining({
      kind: 'MANUAL_REVIEW',
      automatic: false,
    }));
  });

  it('detecta duplicidade e não automatiza valor nem complemento ambíguos', () => {
    const value = agreement();
    value.allocations[1] = {
      ...value.allocations[0]!,
      id: 'allocation-duplicate',
    };
    const audit = analyzeBillingAgreementIntegrity(snapshot({ agreements: [value] }), { now: NOW });

    expect(audit.issues.map((issue) => issue.code)).toContain('DUPLICATE_ACTIVE_ALLOCATION');
    expect(audit.repairPlan).not.toContainEqual(expect.objectContaining({
      kind: 'ALIGN_AGREEMENT_DESIRED_AMOUNT',
      automatic: true,
    }));
    expect(audit.repairPlan).not.toContainEqual(expect.objectContaining({
      kind: 'CREATE_COMPLEMENT_ADJUSTMENT',
      automatic: true,
    }));
  });

  it('rebaixa matrícula provisionada sem acordo consistente', () => {
    const audit = analyzeBillingAgreementIntegrity(snapshot({
      enrollments: [{ id: 'enrollment-orphan', billingProvisionStatus: 'PROVISIONADO' }],
    }), { now: NOW });

    expect(audit.issues).toEqual([expect.objectContaining({
      code: 'PROVISIONED_ENROLLMENT_WITHOUT_CONSISTENT_AGREEMENT',
      enrollmentId: 'enrollment-orphan',
    })]);
    expect(audit.repairPlan).toEqual([expect.objectContaining({
      kind: 'MARK_ENROLLMENT_PARTIAL',
      automatic: true,
    })]);
  });

  it('considera complemento já enfileirado e não propõe cobrança duplicada', () => {
    const value = agreement();
    value.allocations = [value.allocations[0]!];
    value.desiredAmountCents = 30_000;
    value.confirmedAmountCents = 30_000;
    value.allocations[0]!.netAmountCents = 30_000;
    value.remoteStatus = 'ACTIVE';
    value.adjustments = [{
      id: 'adjustment-1',
      type: 'COMPLEMENT',
      status: 'PENDING',
      amountCents: 15_000,
      effectiveDate: '2026-08-05',
      chargeId: 'charge-1',
    }];

    const audit = analyzeBillingAgreementIntegrity(snapshot({ agreements: [value] }), { now: NOW });
    expect(audit.issues.map((issue) => issue.code)).not.toContain('PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT');
    expect(audit.repairPlan.map((action) => action.kind)).not.toContain('CREATE_COMPLEMENT_ADJUSTMENT');
  });

  it('trata validUntil como limite exclusivo ao somar alocações', () => {
    const value = agreement();
    value.allocations = [{ ...value.allocations[0]!, validUntil: '2026-07-31' }];
    value.desiredAmountCents = 0;
    value.confirmedAmountCents = 0;
    value.remoteStatus = 'ACTIVE';
    value.charges = [];

    const audit = analyzeBillingAgreementIntegrity(snapshot({ agreements: [value] }), { now: NOW });
    expect(audit.issues.map((issue) => issue.code)).not.toContain('ACTIVE_ALLOCATION_SUM_MISMATCH');
  });

  it('não confunde pausa local intencional com assinatura expirada', () => {
    const value = agreement();
    value.status = 'INACTIVE';
    value.remoteStatus = 'INACTIVE';
    value.desiredAmountCents = 30_000;
    value.confirmedAmountCents = 30_000;
    value.charges = [];

    const audit = analyzeBillingAgreementIntegrity(snapshot({ agreements: [value] }), { now: NOW });
    expect(audit.issues.map((issue) => issue.code)).not.toContain(
      'EXPIRED_SUBSCRIPTION_WITH_FUTURE_ALLOCATION',
    );
  });
});

describe('reconcileBillingAgreementIntegrity', () => {
  it('é dry-run por padrão e não executa ações', async () => {
    const repository: BillingIntegrityRepository = {
      loadSnapshot: vi.fn(async () => snapshot({
        enrollments: [{ id: 'enrollment-orphan', billingProvisionStatus: 'PROVISIONADO' }],
      })),
      applyRepair: vi.fn(async () => 'APPLIED'),
    };

    const result = await reconcileBillingAgreementIntegrity({ contaId: 'conta-1', repository, now: NOW });
    expect(result.dryRun).toBe(true);
    expect(result.results).toEqual([]);
    expect(repository.applyRepair).not.toHaveBeenCalled();
  });

  it('exige seleção explícita e executa apenas ação pertencente ao plano atual', async () => {
    const repository: BillingIntegrityRepository = {
      loadSnapshot: vi.fn(async () => snapshot({
        enrollments: [{ id: 'enrollment-orphan', billingProvisionStatus: 'PROVISIONADO' }],
      })),
      applyRepair: vi.fn(async () => 'APPLIED'),
    };
    await expect(reconcileBillingAgreementIntegrity({
      contaId: 'conta-1',
      repository,
      now: NOW,
      dryRun: false,
    })).rejects.toThrow('actionIds explícitos');

    const preview = await reconcileBillingAgreementIntegrity({ contaId: 'conta-1', repository, now: NOW });
    const selected = preview.repairPlan[0]!.id;
    const result = await reconcileBillingAgreementIntegrity({
      contaId: 'conta-1',
      repository,
      now: NOW,
      dryRun: false,
      actionIds: [selected],
    });
    expect(repository.applyRepair).toHaveBeenCalledWith({
      contaId: 'conta-1',
      action: expect.objectContaining({ id: selected }),
    });
    expect(result.results).toEqual([expect.objectContaining({ outcome: 'APPLIED' })]);

    await expect(reconcileBillingAgreementIntegrity({
      contaId: 'conta-1',
      repository,
      now: NOW,
      dryRun: false,
      actionIds: ['other-tenant-or-stale-action'],
    })).rejects.toThrow('não pertencem ao plano atual');
  });

  it('rejeita snapshot retornado fora do tenant', async () => {
    const repository: BillingIntegrityRepository = {
      loadSnapshot: vi.fn(async () => snapshot({ contaId: 'conta-2' })),
      applyRepair: vi.fn(async () => 'APPLIED'),
    };
    await expect(reconcileBillingAgreementIntegrity({
      contaId: 'conta-1',
      repository,
    })).rejects.toThrow('fora do tenant');
  });
});
