import { describe, expect, it, vi } from 'vitest';

import { stableFinancialHash } from './fingerprint';
import { calculateBillingAgreementChangePreview } from './calculation';
import { createBillingAgreementLifecycleService } from './service';
import type {
  BillingAgreementChangeInput,
  BillingAgreementChangeResult,
  CommitBillingAgreementChangeInput,
  BillingAgreementContext,
} from './types';

function lifecycleContext(overrides: Partial<BillingAgreementContext> = {}): BillingAgreementContext {
  return {
    agreement: {
      id: 'agreement-1', contaId: 'conta-1',
      payer: { type: 'RESPONSAVEL', id: 'responsavel-1', customerId: 'customer-1' },
      status: 'ACTIVE', billingType: 'PIX', cycle: 'MONTHLY', dueDay: 10,
      nextDueDate: '2026-08-10', validFrom: '2026-01-01', validUntil: null,
      desiredAmountCents: 30_000, confirmedAmountCents: 30_000,
      asaasSubscriptionId: 'sub-1', remoteStatus: 'ACTIVE', version: 1,
      externalReference: 'agreement:one', description: 'Mensalidade',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    },
    allocations: [
      {
        id: 'allocation-one', contaId: 'conta-1', agreementId: 'agreement-1',
        enrollmentId: 'enrollment-one', studentId: 'student-one', kind: 'TUITION',
        status: 'ACTIVE', recurring: true, baseAmountCents: 20_000,
        discountAmountCents: 0, netAmountCents: 20_000, validFrom: '2026-01-01',
        validUntil: null, prorationPolicy: 'FULL_CURRENT_CYCLE',
      },
      {
        id: 'allocation-two', contaId: 'conta-1', agreementId: 'agreement-1',
        enrollmentId: 'enrollment-two', studentId: 'student-two', kind: 'TUITION',
        status: 'ACTIVE', recurring: true, baseAmountCents: 10_000,
        discountAmountCents: 0, netAmountCents: 10_000, validFrom: '2026-01-01',
        validUntil: null, prorationPolicy: 'FULL_CURRENT_CYCLE',
      },
    ],
    charges: [],
    currentCycle: { startsAt: '2026-07-01', endsAt: '2026-08-01' },
    ...overrides,
  };
}

function buildCommitService(context: BillingAgreementContext, input: CommitBillingAgreementChangeInput) {
  const payments = new Map([
    ['payment-current', { id: 'payment-current', status: 'PENDING' as const, valueCents: 30_000, dueDate: '2026-07-10', billingType: 'PIX' as const, deleted: false }],
    ['payment-next', { id: 'payment-next', status: 'PENDING' as const, valueCents: 30_000, dueDate: '2026-08-10', billingType: 'PIX' as const, deleted: false }],
    ['payment-overdue', { id: 'payment-overdue', status: 'OVERDUE' as const, valueCents: 30_000, dueDate: '2026-06-10', billingType: 'PIX' as const, deleted: false }],
  ]);
  const remoteSubscription: {
    id: string; customerId: string; valueCents: number; billingType: string; cycle: string;
    status: string; nextDueDate: string; endDate: string | null; externalReference: string; deleted: boolean;
  } = {
    id: 'sub-1', customerId: 'customer-1', valueCents: context.agreement.confirmedAmountCents, billingType: 'PIX', cycle: 'MONTHLY',
    status: 'ACTIVE', nextDueDate: '2026-08-10', endDate: null,
    externalReference: 'agreement:one', deleted: false,
  };
  const asaas = {
    getSubscription: vi.fn(async () => ({ ...remoteSubscription })),
    listSubscriptionPayments: vi.fn(async () => [...payments.values()]),
    findSubscriptionByExternalReference: vi.fn(async () => null),
    createSubscription: vi.fn(async (args: { valueCents: number; billingType: string; cycle: string; nextDueDate: string; endDate: string | null; externalReference: string }) => ({
      id: 'sub-replacement', customerId: 'customer-1', valueCents: args.valueCents,
      billingType: args.billingType, cycle: args.cycle, status: 'ACTIVE', nextDueDate: args.nextDueDate,
      endDate: args.endDate, externalReference: args.externalReference, deleted: false,
    })),
    updateSubscription: vi.fn(async (args: { valueCents: number; status?: 'ACTIVE' | 'INACTIVE' }) => {
      remoteSubscription.valueCents = args.valueCents;
      if (args.status) remoteSubscription.status = args.status;
      return { ...remoteSubscription };
    }),
    deleteSubscription: vi.fn(async () => ({ id: 'sub-1', deleted: true })),
    getPayment: vi.fn(async ({ paymentId }: { paymentId: string }) => ({ ...payments.get(paymentId)! })),
    updatePayment: vi.fn(async (args: { paymentId: string; valueCents: number }) => {
      const payment = payments.get(args.paymentId)!;
      const next = { ...payment, valueCents: args.valueCents };
      payments.set(args.paymentId, next);
      return next;
    }),
    deletePayment: vi.fn(async ({ paymentId }: { paymentId: string }) => {
      const payment = payments.get(paymentId)!;
      payments.set(paymentId, { ...payment, deleted: true });
      return { id: paymentId, deleted: true };
    }),
  };
  const operation = { id: 'operation-1', remoteProgress: [] };
  const applied = vi.fn(async (args: { remoteProgress: unknown[] }) => ({
    operationId: operation.id, uiRequestId: input.uiRequestId, status: 'COMPLETED' as const,
    agreementIds: ['agreement-1'], resultingAmountsCents: { 'agreement-1': 20_000 }, versions: { 'agreement-1': 2 },
    adjustments: [], remoteProgress: args.remoteProgress as never[], correlationId: 'correlation-1',
  }));
  const repository = {
    getAgreementContext: vi.fn(async () => context),
    getOperationByRequest: vi.fn(async () => null),
    reserveOperation: vi.fn(async () => ({ outcome: 'RESERVED' as const, operation })),
    recordRemoteProgress: vi.fn(async () => undefined),
    applyConfirmedChange: applied,
    markOperationUncertain: vi.fn(async () => undefined),
    markOperationFailed: vi.fn(async () => undefined),
  };
  const service = createBillingAgreementLifecycleService({
    repository: repository as never,
    asaas: asaas as never,
    lock: { withAgreementLocks: async ({ run }) => ({ acquired: true as const, result: await run(async () => undefined) }) },
    audit: { record: vi.fn(async () => undefined) },
    now: () => new Date('2026-07-21T12:00:00.000Z'),
  });
  return { service, asaas, payments, repository, applied, remoteSubscription };
}

describe('BillingAgreementLifecycleService idempotency', () => {
  it('devolve commit concluído sem reler acordo nem exigir preview ainda vigente', async () => {
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'retry',
      kind: 'ADD_ALLOCATION', effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-31',
      allocations: [{
        enrollmentId: 'enrollment-1', studentId: 'student-1', kind: 'TUITION', recurring: true,
        baseAmountCents: 15_000, netAmountCents: 15_000,
      }],
    };
    const input: CommitBillingAgreementChangeInput = {
      ...change,
      uiRequestId: 'request-1', previewHash: 'preview-1',
      previewExpiresAt: '2026-07-31T11:00:00.000Z', expectedAgreementVersion: 1,
    };
    const result: BillingAgreementChangeResult = {
      operationId: 'operation-1', uiRequestId: 'request-1', status: 'COMPLETED',
      agreementIds: ['agreement-1'], resultingAmountsCents: { 'agreement-1': 15_000 },
      versions: { 'agreement-1': 2 }, adjustments: [], remoteProgress: [], correlationId: 'correlation-1',
    };
    const getAgreementContext = vi.fn();
    const repository = {
      getAgreementContext,
      getOperationByRequest: vi.fn().mockResolvedValue({
        id: 'operation-1', contaId: 'conta-1', uiRequestId: 'request-1', kind: 'ADD_ALLOCATION',
        status: 'COMPLETED',
        requestFingerprint: stableFinancialHash({ change, previewHash: 'preview-1', expectedAgreementVersion: 1 }),
        sourceAgreementId: 'agreement-1', targetAgreementId: null, expectedVersion: 1,
        previewHash: 'preview-1', effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-31',
        correlationId: 'correlation-1', remoteProgress: [], result, errorCode: null,
      }),
    };
    const service = createBillingAgreementLifecycleService({
      repository: repository as never,
      asaas: {} as never,
      lock: { withAgreementLocks: async ({ run }) => ({ acquired: true as const, result: await run(async () => {}) }) },
      audit: { record: vi.fn() },
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });

    await expect(service.commit(input)).resolves.toEqual(result);
    expect(getAgreementContext).not.toHaveBeenCalled();
  });

  it('marca para reconciliação se atualização parcial falha após mudar a assinatura', async () => {
    const context = lifecycleContext({
      charges: [
        { id: 'charge-current', contaId: 'conta-1', agreementId: 'agreement-1', allocationId: null, providerPaymentId: 'payment-current', status: 'PENDING', amountCents: 30_000, dueDate: '2026-07-10' },
        { id: 'charge-next', contaId: 'conta-1', agreementId: 'agreement-1', allocationId: null, providerPaymentId: 'payment-next', status: 'PENDING', amountCents: 30_000, dueDate: '2026-08-10' },
      ],
    });
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'Cancelamento de participação',
      kind: 'REMOVE_ALLOCATION', allocationIds: ['allocation-two'],
      effectivePolicy: 'CURRENT_CYCLE_PRORATED', effectiveDate: '2026-07-21',
    };
    const preview = calculateBillingAgreementChangePreview({
      change, sourceContext: context, now: new Date('2026-07-21T12:00:00.000Z'), previewTtlMs: 60_000,
    });
    const input: CommitBillingAgreementChangeInput = {
      ...change, uiRequestId: 'request-prorata', previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt, expectedAgreementVersion: 1,
    };
    const { service, asaas, payments, repository } = buildCommitService(context, input);
    vi.mocked(asaas.updatePayment).mockRejectedValueOnce(new Error('provider timeout after subscription update'));

    const result = await service.commit(input);

    expect(result.status).toBe('REQUIRES_RECONCILIATION');
    expect(asaas.updateSubscription).toHaveBeenCalled();
    expect(repository.markOperationUncertain).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'REMOTE_OPERATION_UNCERTAIN',
    }));
    expect(asaas.updatePayment).toHaveBeenCalledTimes(1);
    expect(asaas.deleteSubscription).not.toHaveBeenCalled();
    expect(payments.get('payment-next')?.valueCents).toBe(30_000);
  });

  it('atualiza somente o pagamento do ciclo parcial e preserva pagamentos futuros recorrentes', async () => {
    const context = lifecycleContext({
      charges: [
        { id: 'charge-current', contaId: 'conta-1', agreementId: 'agreement-1', allocationId: null, providerPaymentId: 'payment-current', status: 'PENDING', amountCents: 30_000, dueDate: '2026-07-10' },
        { id: 'charge-next', contaId: 'conta-1', agreementId: 'agreement-1', allocationId: null, providerPaymentId: 'payment-next', status: 'PENDING', amountCents: 30_000, dueDate: '2026-08-10' },
      ],
    });
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'Cancelamento de participação',
      kind: 'REMOVE_ALLOCATION', allocationIds: ['allocation-two'],
      effectivePolicy: 'CURRENT_CYCLE_PRORATED', effectiveDate: '2026-07-21',
    };
    const preview = calculateBillingAgreementChangePreview({
      change, sourceContext: context, now: new Date('2026-07-21T12:00:00.000Z'), previewTtlMs: 60_000,
    });
    const input: CommitBillingAgreementChangeInput = {
      ...change, uiRequestId: 'request-prorata', previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt, expectedAgreementVersion: 1,
    };
    const { service, asaas, payments } = buildCommitService(context, input);

    await service.commit(input);

    expect(asaas.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({ valueCents: 20_000, updatePendingPayments: false }));
    expect(asaas.updatePayment).toHaveBeenCalledTimes(1);
    expect(asaas.updatePayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'payment-current', valueCents: preview.plans[0]!.chargeImpacts[0]!.targetAmountCents,
    }));
    expect(payments.get('payment-current')?.valueCents).toBe(preview.plans[0]!.chargeImpacts[0]!.targetAmountCents);
    expect(payments.get('payment-next')?.valueCents).toBe(30_000);
  });

  it('inativa recorrência no último vínculo com overdue sem excluir subscription ou dívida', async () => {
    const source = lifecycleContext({
      allocations: [lifecycleContext().allocations[0]!],
      charges: [{
        id: 'charge-overdue', contaId: 'conta-1', agreementId: 'agreement-1', allocationId: null,
        providerPaymentId: 'payment-overdue', status: 'OVERDUE', amountCents: 20_000, dueDate: '2026-06-10',
      }],
    });
    source.agreement.desiredAmountCents = 20_000;
    source.agreement.confirmedAmountCents = 20_000;
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'Cancelamento de participação',
      kind: 'REMOVE_ALLOCATION', allocationIds: ['allocation-one'],
      effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-21',
    };
    const preview = calculateBillingAgreementChangePreview({
      change, sourceContext: source, now: new Date('2026-07-21T12:00:00.000Z'), previewTtlMs: 60_000,
    });
    const input: CommitBillingAgreementChangeInput = {
      ...change, uiRequestId: 'request-overdue-close', previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt, expectedAgreementVersion: 1,
    };
    const { service, asaas, payments } = buildCommitService(source, input);

    const result = await service.commit(input);

    expect(result.status).toBe('COMPLETED');
    expect(asaas.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: 'INACTIVE', valueCents: 20_000 }));
    expect(asaas.deleteSubscription).not.toHaveBeenCalled();
    expect(asaas.deletePayment).not.toHaveBeenCalled();
    expect(payments.get('payment-overdue')).toMatchObject({ status: 'OVERDUE', deleted: false, valueCents: 30_000 });
  });

  it('detecta overdue só no Asaas antes da remoção final e inativa sem DELETE', async () => {
    const source = lifecycleContext({ allocations: [lifecycleContext().allocations[0]!], charges: [] });
    source.agreement.desiredAmountCents = 20_000;
    source.agreement.confirmedAmountCents = 20_000;
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'Cancelamento',
      kind: 'REMOVE_ALLOCATION', allocationIds: ['allocation-one'],
      effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-21',
    };
    const preview = calculateBillingAgreementChangePreview({
      change, sourceContext: source, now: new Date('2026-07-21T12:00:00.000Z'), previewTtlMs: 60_000,
    });
    const input: CommitBillingAgreementChangeInput = {
      ...change, uiRequestId: 'request-remote-only-overdue-delete', previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt, expectedAgreementVersion: 1,
    };
    const { service, asaas, payments } = buildCommitService(source, input);

    const result = await service.commit(input);

    expect(result.status).toBe('COMPLETED');
    expect(asaas.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub-1', status: 'INACTIVE', updatePendingPayments: false,
    }));
    expect(asaas.deleteSubscription).not.toHaveBeenCalled();
    expect(asaas.deletePayment).not.toHaveBeenCalled();
    expect(payments.get('payment-overdue')).toMatchObject({ status: 'OVERDUE', deleted: false });
    expect(result.remoteProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'PAUSE_SUBSCRIPTION', resultingSubscriptionId: 'sub-1', confirmed: true }),
    ]));
  });

  it('inativa subscription antiga antes de substituir quando overdue só existe no Asaas', async () => {
    const source = lifecycleContext({ charges: [] });
    const change: BillingAgreementChangeInput = {
      contaId: 'conta-1', agreementId: 'agreement-1', actorId: 'user-1', reason: 'Remover término remoto',
      kind: 'REMOVE_ALLOCATION', allocationIds: ['allocation-two'],
      effectivePolicy: 'CURRENT_CYCLE_FULL', effectiveDate: '2026-07-21',
    };
    const preview = calculateBillingAgreementChangePreview({
      change, sourceContext: source, now: new Date('2026-07-21T12:00:00.000Z'), previewTtlMs: 60_000,
    });
    const input: CommitBillingAgreementChangeInput = {
      ...change, uiRequestId: 'request-remote-only-overdue-replace', previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt, expectedAgreementVersion: 1,
    };
    const { service, asaas, payments, remoteSubscription } = buildCommitService(source, input);
    remoteSubscription.endDate = '2026-12-31';
    payments.delete('payment-current');
    payments.delete('payment-next');
    vi.mocked(asaas.getSubscription).mockImplementation(async ({ subscriptionId }) => ({
      ...remoteSubscription,
      id: subscriptionId,
      valueCents: subscriptionId === 'sub-replacement' ? 20_000 : remoteSubscription.valueCents,
      status: subscriptionId === 'sub-replacement' ? 'ACTIVE' : remoteSubscription.status,
      endDate: subscriptionId === 'sub-replacement' ? null : remoteSubscription.endDate,
      externalReference: subscriptionId === 'sub-replacement' ? 'agreement:one:end-date:request-rem' : remoteSubscription.externalReference,
    }));
    vi.mocked(asaas.listSubscriptionPayments).mockImplementation(async ({ subscriptionId }) =>
      subscriptionId === 'sub-1' ? [payments.get('payment-overdue')!] : [],
    );

    const result = await service.commit(input);

    expect(result.status).toBe('COMPLETED');
    expect(asaas.updateSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      asaas.createSubscription.mock.invocationCallOrder[0]!,
    );
    expect(asaas.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub-1', status: 'INACTIVE', updatePendingPayments: false,
    }));
    expect(asaas.deleteSubscription).not.toHaveBeenCalled();
    expect(asaas.getSubscription).toHaveBeenCalledWith({ contaId: 'conta-1', subscriptionId: 'sub-1' });
    expect(payments.get('payment-overdue')).toMatchObject({ status: 'OVERDUE', deleted: false });
    expect(result.remoteProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'REPLACE_SUBSCRIPTION', resultingSubscriptionId: 'sub-replacement', confirmed: true }),
    ]));
  });
});
