import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  outboxFindUnique: vi.fn(), outboxUpdateMany: vi.fn(), standaloneFindFirst: vi.fn(),
  standaloneUpdateMany: vi.fn(), rematriculaUpdateMany: vi.fn(), operationFindFirst: vi.fn(),
  adjustmentFindFirst: vi.fn(), allocationFindMany: vi.fn(), materialize: vi.fn(),
  preview: vi.fn(), commit: vi.fn(), processAdjustments: vi.fn(), familyFindFirst: vi.fn(),
  familyAllocationFindMany: vi.fn(), familyAllocationUpdateMany: vi.fn(), createStandaloneCharge: vi.fn(),
  familyProvisionUpdateMany: vi.fn(), enrollmentUpdateMany: vi.fn(), accountFindUnique: vi.fn(),
  enrollmentFindMany: vi.fn(), familyAllocationFindFirst: vi.fn(),
  familyOperationUpdateMany: vi.fn(), familyOperationFindFirst: vi.fn(), outboxFindFirst: vi.fn(),
  getSubscription: vi.fn(), billingAllocationCount: vi.fn(),
  outboxFindMany: vi.fn(),
  subscriptionFindMany: vi.fn(), deletePayment: vi.fn(), deleteSubscription: vi.fn(), listPayments: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: { findUnique: mocks.accountFindUnique },
    matriculaFamiliar: { findFirst: mocks.familyFindFirst, findMany: vi.fn().mockResolvedValue([]), updateMany: mocks.familyProvisionUpdateMany },
    matricula: { findMany: mocks.enrollmentFindMany },
    familyFinancialAllocation: {
      findMany: mocks.familyAllocationFindMany,
      findFirst: mocks.familyAllocationFindFirst,
      updateMany: mocks.familyAllocationUpdateMany,
    },
    charge: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    chargeReadModel: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      matriculaFamiliar: { updateMany: mocks.familyProvisionUpdateMany },
      conta: { findUnique: mocks.accountFindUnique },
      charge: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      chargeReadModel: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matricula: { findMany: mocks.enrollmentFindMany, updateMany: mocks.enrollmentUpdateMany },
    standaloneSubscription: { findMany: mocks.subscriptionFindMany, updateMany: mocks.standaloneUpdateMany },
      rematriculaFamiliar: { updateMany: mocks.rematriculaUpdateMany },
      rematriculaFamiliarItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      familyEnrollmentOperation: {
        updateMany: mocks.familyOperationUpdateMany,
        findFirst: mocks.familyOperationFindFirst,
      },
      familyBillingOutbox: { updateMany: mocks.outboxUpdateMany },
      familyFinancialAllocation: { updateMany: mocks.familyAllocationUpdateMany },
    })),
    familyBillingOutbox: { findUnique: mocks.outboxFindUnique, findFirst: mocks.outboxFindFirst, findMany: mocks.outboxFindMany, updateMany: mocks.outboxUpdateMany },
    standaloneSubscription: { findFirst: mocks.standaloneFindFirst, findMany: mocks.subscriptionFindMany, updateMany: mocks.standaloneUpdateMany },
    familyEnrollmentOperation: { updateMany: mocks.familyOperationUpdateMany, findFirst: mocks.familyOperationFindFirst },
    rematriculaFamiliar: { updateMany: mocks.rematriculaUpdateMany },
    billingChangeOperation: { findFirst: mocks.operationFindFirst },
    billingAdjustment: { findFirst: mocks.adjustmentFindFirst },
    billingAllocation: { findMany: mocks.allocationFindMany, count: mocks.billingAllocationCount },
  },
}));
vi.mock('../use-cases/create-standalone-charge', () => ({ createStandaloneCharge: mocks.createStandaloneCharge }));
vi.mock('../use-cases/asaas-ops', () => ({
  getSubscription: mocks.getSubscription, deleteSubscription: mocks.deleteSubscription,
  deletePayment: mocks.deletePayment, listPayments: mocks.listPayments,
}));
vi.mock('../projections/enrollment-fee-projection.service', () => ({ projectFamilyEnrollmentFeeState: vi.fn() }));
vi.mock('../billing-agreements/materialize.js', () => ({ materializeBillingAgreement: mocks.materialize }));
vi.mock('../billing-agreements/runtime.js', () => ({
  previewBillingAgreementChange: mocks.preview,
  commitBillingAgreementChange: mocks.commit,
}));
vi.mock('../billing-agreements/adjustment-processor.js', () => ({
  processPendingBillingAdjustments: mocks.processAdjustments,
}));

import { compensateFamilyCreationRemoteEffects, executeFamilyBilling, parseFamilyBillingPayload, processFamilyBillingOutboxBatch, processFamilyBillingOutboxEvent } from './processor';

describe('future family billing outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.familyAllocationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyAllocationFindMany.mockResolvedValue([]);
    mocks.createStandaloneCharge.mockResolvedValue({ success: true, data: { chargeId: 'charge-fee' } });
    mocks.familyProvisionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.enrollmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.enrollmentFindMany.mockResolvedValue([]);
    mocks.familyAllocationFindFirst.mockResolvedValue(null);
    mocks.accountFindUnique.mockResolvedValue({ matriculaActivationPolicy: 'IMMEDIATE' });
    mocks.familyOperationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyOperationFindFirst.mockResolvedValue(null);
    mocks.outboxFindFirst.mockResolvedValue(null);
    mocks.outboxFindMany.mockResolvedValue([]);
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.subscriptionFindMany.mockResolvedValue([]);
    mocks.deletePayment.mockResolvedValue(undefined);
    mocks.deleteSubscription.mockResolvedValue(undefined);
    mocks.listPayments.mockResolvedValue({ data: [] });
    mocks.getSubscription.mockResolvedValue({ value: 100, status: 'ACTIVE' });
    mocks.standaloneUpdateMany.mockResolvedValue({ count: 1 });
    mocks.billingAllocationCount.mockResolvedValue(1);
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      eventType: 'FUTURE_FAMILY_RECURRING:operation-1', status: 'PENDING',
      availableAt: new Date(Date.now() + 60_000), payload: {},
    });
  });

  it('limits automatic reconciliation replays to eight attempts', async () => {
    await processFamilyBillingOutboxBatch({ contaId: 'conta-1' });
    const batchSelection = mocks.outboxFindMany.mock.calls[2]?.[0];
    expect(batchSelection).toMatchObject({
      where: {
        status: { in: ['PENDING', 'FAILED', 'REQUIRES_RECONCILIATION'] },
        attempts: { lt: 8 },
        contaId: 'conta-1',
      },
    });
  });

  it('moves exhausted open family events to durable reconciliation state', async () => {
    mocks.outboxFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'capped-family-event', contaId: 'conta-1', matriculaFamiliarId: 'family-1',
        payload: {
          aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
          responsavelId: 'resp-1', totalAlunos: 1, monthlyValue: 100, enrollmentFeeValue: 0,
          billingType: 'BOLETO', cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: '2027-10-31',
          enrollmentFeeDueDate: '2026-10-10', description: 'Matrícula', actorId: 'user-1', operationId: 'op-1',
        },
      }])
      .mockResolvedValueOnce([]);
    await processFamilyBillingOutboxBatch({ contaId: 'conta-1' });
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ attempts: { gte: 8 }, status: { in: ['PENDING', 'FAILED'] } }),
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION', lastError: 'LIMITE_DE_TENTATIVAS_ATINGIDO_REQUER_RECONCILIACAO' }),
    }));
  });

  it('does not let direct ID processing run before availableAt', async () => {
    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({
      processed: false,
      reason: 'NOT_YET_AVAILABLE',
    });
    expect(mocks.outboxUpdateMany).not.toHaveBeenCalled();
  });

  it('bloqueia recorrência futura em reconciliação após falha na taxa', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      eventType: 'FUTURE_FAMILY_RECURRING:operation-1', status: 'REQUIRES_RECONCILIATION',
      availableAt: new Date(0), payload: {},
    });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({
      processed: false,
      reason: 'NOT_FOUND_OR_ALREADY_PROCESSED',
    });
    expect(mocks.outboxUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
  });

  it('preserves fee and activation schedule in the persisted payload', () => {
    const payload = parseFamilyBillingPayload({
      aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
      responsavelId: 'responsavel-1', totalAlunos: 2, monthlyValue: 0, enrollmentFeeValue: 100,
      billingType: 'BOLETO', cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: '2027-10-31',
      enrollmentFeeDueDate: '2026-10-10', description: 'Matrícula', actorId: 'user-1',
      billingPhase: 'ENROLLMENT_FEE', deferActivationUntil: '2026-11-01T04:00:00.000Z',
    });
    expect(payload).toMatchObject({
      billingPhase: 'ENROLLMENT_FEE',
      enrollmentFeeValue: 100,
      monthlyValue: 0,
      deferActivationUntil: '2026-11-01T04:00:00.000Z',
    });
  });

  it('mantém provisionamento pendente após materializar a taxa antes da vigência', async () => {
    await executeFamilyBilling({
      aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
      responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
      monthlyValue: 0, enrollmentFeeValue: 100, billingType: 'BOLETO', cycle: 'MONTHLY',
      nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
      description: 'Matrícula', actorId: 'user-1', operationId: 'operation-1',
      strategy: 'SEPARATE', billingPhase: 'ENROLLMENT_FEE',
      deferActivationUntil: '2026-11-01T04:00:00.000Z',
    });

    expect(mocks.familyProvisionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ billingProvisionStatus: 'PENDENTE' }),
    }));
    expect(mocks.enrollmentUpdateMany).not.toHaveBeenCalled();
  });

  it('ativa membro familiar sem cobrança quando a vigência chega e preserva NAO_APLICAVEL', async () => {
    mocks.accountFindUnique.mockResolvedValue({ matriculaActivationPolicy: 'IMMEDIATE', timezone: 'America/Manaus' });
    mocks.enrollmentFindMany.mockResolvedValue([{
      id: 'mat-no-billing', status: 'AGUARDANDO_CONFIRMACAO', taxaStatus: 'ISENTO',
      taxaIsenta: true, taxaMatricula: 0, dataInicio: new Date(0),
      billingProvisionStatus: 'NAO_APLICAVEL',
    }]);

    await executeFamilyBilling({
      aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
      responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
      monthlyValue: 0, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
      nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
      description: 'Matrícula', actorId: 'user-1', operationId: 'operation-no-billing',
      strategy: 'SEPARATE', billingPhase: 'RECURRING',
    });

    expect(mocks.enrollmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'mat-no-billing', billingProvisionStatus: 'NAO_APLICAVEL' }),
      data: expect.objectContaining({ status: 'ATIVA' }),
    }));
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
    expect(mocks.getSubscription).not.toHaveBeenCalled();
  });

  it('cancels a scheduled recurring event when the family became terminal', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', totalAlunos: 1, monthlyValue: 100, enrollmentFeeValue: 0,
        billingType: 'BOLETO', cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: '2027-10-31',
        enrollmentFeeDueDate: '2026-10-10', description: 'Matrícula', actorId: 'user-1',
        billingPhase: 'RECURRING',
      },
    });
    mocks.outboxUpdateMany.mockReset().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.familyFindFirst.mockResolvedValue({ status: 'CANCELADO', matriculas: [{ status: 'CANCELADA' }] });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({
      processed: false,
      reason: 'REQUIRES_RECONCILIATION',
    });
    expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ claimToken: expect.any(String), leaseExpiresAt: { gt: expect.any(Date) } }),
      data: expect.objectContaining({ status: 'PROCESSED', lastError: 'SKIPPED:FAMILIA_ENCERRADA_ANTES_DA_VIGENCIA' }),
    }));
  });

  it('does not report a family close as complete when the fenced final update loses its claim', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-close', contaId: 'conta-1', aggregateId: 'family-1', aggregateType: 'MATRICULA_FAMILIAR',
      eventType: 'CLOSE_MATRICULA_FAMILIAR_SUBSCRIPTION', status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: { contaId: 'conta-1', aggregateId: 'family-1', sourceFinancialAgreementId: 'subscription-1', effectiveDate: '2026-10-10' },
    });
    mocks.outboxUpdateMany.mockReset().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.familyFindFirst.mockResolvedValue({
      id: 'family-1', status: 'CANCELADO', standaloneSubscriptionId: 'subscription-1',
      matriculas: [{ status: 'CANCELADA', rematriculasDerivadas: [] }],
    });
    mocks.standaloneFindFirst.mockResolvedValue({ id: 'subscription-1', asaasSubscriptionId: null, familyGroupId: null });
    mocks.operationFindFirst.mockResolvedValue({ id: 'completed-op' });
    mocks.adjustmentFindFirst.mockResolvedValue(null);

    await expect(processFamilyBillingOutboxEvent('outbox-close')).resolves.toEqual({
      processed: false,
      reason: 'REQUIRES_RECONCILIATION',
    });
    expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ claimToken: expect.any(String), leaseExpiresAt: { gt: expect.any(Date) } }),
    }));
  });

  it('reagendas a recorrência familiar se algum membro ainda não entrou em vigência', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', totalAlunos: 1, monthlyValue: 100, enrollmentFeeValue: 0,
        billingType: 'BOLETO', cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: '2027-10-31',
        enrollmentFeeDueDate: '2026-10-10', description: 'Matrícula', actorId: 'user-1',
        billingPhase: 'RECURRING', scheduledEffectiveAt: '2026-10-10T04:00:00.000Z',
      },
    });
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE',
      matriculas: [{ id: 'mat-1', status: 'AGUARDANDO_CONFIRMACAO', dataInicio: new Date(Date.now() + 5 * 86400000), cobrarDurantePausa: false }],
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({
      processed: false,
      reason: 'NOT_YET_EFFECTIVE',
    });
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING', lastError: 'AGUARDANDO_INICIO_ACADEMICO_ATUALIZADO' }),
    }));
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
  });

  it('processes only remaining family allocations when one student is terminal', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 2,
        monthlyValue: 300, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE',
      matriculas: [
        { id: 'mat-active', status: 'ATIVA' },
        { id: 'mat-cancelled', status: 'CANCELADA' },
      ],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([
      { matriculaId: 'mat-active', amount: 180 },
      { matriculaId: 'mat-cancelled', amount: 120 },
    ]);
    mocks.materialize.mockResolvedValue({ id: 'agreement-1' });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({ processed: true });

    const claimCall = mocks.outboxUpdateMany.mock.calls.find(([args]) => args.data?.claimToken);
    expect(claimCall?.[0].data.claimToken).toEqual(expect.any(String));
    const claimToken = claimCall?.[0].data.claimToken;
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'outbox-future', claimToken, leaseExpiresAt: { gt: expect.any(Date) } }),
      data: expect.objectContaining({ status: 'PROCESSED' }),
    }));

    expect(mocks.familyAllocationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1', familyGroupId: 'family-1', familyEnrollmentOperationId: 'operation-1' }),
    }));
    expect(mocks.createStandaloneCharge).toHaveBeenCalledWith(expect.objectContaining({ value: 180 }));
    expect(mocks.familyAllocationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1', matriculaId: { in: ['mat-cancelled'] } }),
      data: { status: 'CANCELLED' },
    }));
  });

  it('preserves paid future member status until the family contract start', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 180, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2099-11-01', endDate: '2100-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyFindFirst.mockResolvedValue({ status: 'PENDENTE', matriculas: [{ id: 'mat-future', status: 'PENDENTE_TAXA' }] });
    mocks.familyAllocationFindMany.mockResolvedValue([{ matriculaId: 'mat-future', amount: 180 }]);
    mocks.enrollmentFindMany.mockResolvedValue([{
      id: 'mat-future', status: 'PENDENTE_TAXA', taxaStatus: 'PAGO', taxaIsenta: false,
      taxaMatricula: 90, dataInicio: new Date('2099-11-01T00:00:00.000Z'),
    }]);
    mocks.accountFindUnique.mockResolvedValue({ matriculaActivationPolicy: 'REQUIRES_PAYMENT', timezone: 'America/Manaus' });
    mocks.materialize.mockResolvedValue({ id: 'agreement-1' });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({ processed: true });

    expect(mocks.enrollmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'mat-future', contaId: 'conta-1' }),
      data: expect.not.objectContaining({ status: 'ATIVA' }),
    }));
  });

  it('fails closed before creating a financial effect if family billing ownership is lost', async () => {
    const ownershipGuard = vi.fn().mockRejectedValue(new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN'));
    await expect(executeFamilyBilling({
      aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
      responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
      monthlyValue: 100, enrollmentFeeValue: 50, billingType: 'BOLETO', cycle: 'MONTHLY',
      nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
      description: 'Matrícula familiar', actorId: 'user-1', strategy: 'SEPARATE', uiRequestId: 'request-1',
    }, ownershipGuard)).rejects.toThrow('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
    expect(ownershipGuard).toHaveBeenCalledTimes(1);
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
  });

  it('does not mutate family state when the transactional ownership barrier loses to recovery', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-race', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'SYNC_FAMILY_BILLING', status: 'PENDING', attempts: 0,
      availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 100, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', strategy: 'SEPARATE', uiRequestId: 'request-1',
      },
    });
    let ownershipAttempts = 0;
    mocks.outboxUpdateMany.mockImplementation(async () => {
      ownershipAttempts += 1;
      return { count: ownershipAttempts < 4 ? 1 : 0 };
    });
    mocks.createStandaloneCharge.mockResolvedValue({ success: true, data: { chargeId: 'remote-charge-1' } });

    await expect(processFamilyBillingOutboxEvent('outbox-race')).resolves.toEqual({
      processed: false,
      reason: 'REQUIRES_RECONCILIATION',
    });
    expect(ownershipAttempts).toBeGreaterThanOrEqual(4);
    expect(mocks.createStandaloneCharge).toHaveBeenCalledOnce();
    expect(mocks.standaloneUpdateMany).not.toHaveBeenCalled();
    expect(mocks.familyProvisionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.familyAllocationUpdateMany).not.toHaveBeenCalled();
  });

  it('não reativa academicamente aluno pausado ao provisionar recorrência dos irmãos', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 2,
        monthlyValue: 300, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE',
      matriculas: [
        { id: 'mat-active', status: 'ATIVA', cobrarDurantePausa: false },
        { id: 'mat-paused', status: 'PAUSADA', cobrarDurantePausa: false },
      ],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([
      { matriculaId: 'mat-active', amount: 180, status: 'PENDING', sourceChargeId: null },
      { matriculaId: 'mat-paused', amount: 120, status: 'PENDING', sourceChargeId: null },
    ]);
    mocks.materialize.mockResolvedValue({ id: 'agreement-1' });

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({ processed: true });

    expect(mocks.createStandaloneCharge).toHaveBeenCalledWith(expect.objectContaining({ value: 180 }));
    expect(mocks.enrollmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['mat-active'] } }),
    }));
    expect(mocks.enrollmentUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PAUSADA' }),
      data: expect.objectContaining({ status: 'ATIVA' }),
    }));
    expect(mocks.familyAllocationUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'CANCELLED' },
    }));
  });

  it('não persiste compensação local se o claim for perdido após apagar assinatura no provider', async () => {
    mocks.subscriptionFindMany.mockResolvedValue([{ id: 'subscription-local', asaasSubscriptionId: 'asaas-subscription' }]);
    mocks.listPayments.mockResolvedValue({ data: [] });
    const payload = parseFamilyBillingPayload({
      aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
      responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
      monthlyValue: 100, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
      nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
      description: 'Matrícula familiar', actorId: 'user-1', strategy: 'SEPARATE',
      uiRequestId: 'request-1', billingPhase: 'RECURRING',
    });
    const ownershipGuard = async (tx?: { familyBillingOutbox: { updateMany: typeof mocks.outboxUpdateMany } }) => {
      if (!tx) return;
      const result = await tx.familyBillingOutbox.updateMany({ where: { claimToken: 'claim-1' } });
      if (result.count !== 1) throw new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
    };
    mocks.outboxUpdateMany.mockResolvedValue({ count: 0 });

    await expect(compensateFamilyCreationRemoteEffects(payload, ownershipGuard))
      .rejects.toThrow('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');

    expect(mocks.deleteSubscription).toHaveBeenCalledWith('asaas-subscription', { contaId: 'conta-1' });
    expect(mocks.standaloneUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    { attempts: 2, status: 'PENDING', lastError: 'RECORRENCIA_FUTURA_AGUARDANDO_CONFIRMACAO_DA_TAXA' },
    { attempts: 7, status: 'REQUIRES_RECONCILIATION', lastError: 'LIMITE_DE_TENTATIVAS_AGUARDANDO_CONFIRMACAO_DA_TAXA' },
  ])('agenda retry com backoff e limita tentativas quando a taxa continua sem confirmação (attempts=$attempts)', async ({ attempts, status, lastError }) => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'REQUIRES_RECONCILIATION', attempts, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 120, enrollmentFeeValue: 50, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.familyFindFirst.mockResolvedValue({ status: 'PENDENTE', matriculas: [{ id: 'mat-1', status: 'PENDENTE_TAXA', cobrarDurantePausa: false }] });
    mocks.outboxFindFirst.mockResolvedValue({ status: 'FAILED' });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });

    await expect(processFamilyBillingOutboxEvent('outbox-future', { allowReconciliation: true })).resolves.toEqual({
      processed: false,
      reason: 'ENROLLMENT_FEE_NOT_CONFIRMED',
    });
    expect(mocks.getSubscription).not.toHaveBeenCalled();
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
    expect(mocks.outboxUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status, lastError, availableAt: expect.any(Date) }),
    }));
  });

  it('não reativa família cancelada durante o I/O remoto da recorrência', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 100, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.familyFindFirst.mockResolvedValue({ status: 'PENDENTE', matriculas: [{ id: 'mat-1', status: 'PENDENTE_TAXA', cobrarDurantePausa: false }] });
    mocks.familyAllocationFindMany.mockResolvedValue([{ matriculaId: 'mat-1', amount: 100, status: 'PENDING', sourceChargeId: null }]);
    mocks.familyProvisionUpdateMany.mockResolvedValue({ count: 0 });

    const result = await processFamilyBillingOutboxEvent('outbox-future');

    expect(result).toMatchObject({ processed: false, reason: 'REQUIRES_RECONCILIATION' });
    expect(mocks.createStandaloneCharge).toHaveBeenCalled();
    expect(mocks.familyProvisionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['PENDENTE', 'ATIVO', 'PARCIAL'] } }),
    }));
    expect(mocks.enrollmentUpdateMany).not.toHaveBeenCalled();
  });

  it('aplica JOIN futuro somente após availableAt e agenda a alocação no ciclo NEXT_CYCLE', async () => {
    const event = {
      id: 'outbox-future-join', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-join',
      status: 'PENDING', attempts: 0, availableAt: new Date(Date.now() + 60_000),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 50, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-12-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-join',
        strategy: 'JOIN_EXISTING_CURRENT_CYCLE', targetStandaloneSubscriptionId: 'existing-sub',
        expectedBillingVersion: 2, previousMonthlyValue: 100, resultingMonthlyValue: 150,
        scheduledEffectiveAt: '2026-11-01T04:00:00.000Z', billingPhase: 'RECURRING',
      },
    };
    mocks.outboxFindUnique.mockImplementation(async () => ({ ...event }));
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE', billingVersion: 2,
      matriculas: [{ id: 'mat-future', status: 'PENDENTE_TAXA', cobrarDurantePausa: false }],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([{
      id: 'allocation-future', matriculaId: 'mat-future', alunoId: 'student-1', amount: 50,
      baseAmount: 50, discountAmount: 0, competenceStart: new Date('2026-11-01T00:00:00Z'),
      competenceEnd: new Date('2026-11-30T00:00:00Z'), status: 'PENDING', sourceChargeId: null,
    }]);
    mocks.standaloneFindFirst.mockResolvedValue({ id: 'existing-sub', asaasSubscriptionId: 'asaas-existing' });
    mocks.getSubscription.mockResolvedValue({ value: 100, status: 'ACTIVE' });
    mocks.materialize.mockResolvedValue({ id: 'agreement-existing' });
    mocks.operationFindFirst.mockResolvedValue(null);
    mocks.preview.mockResolvedValue({ blockers: [], warnings: [], adjustments: [], previewHash: 'hash', expiresAt: '2026-11-01T05:00:00.000Z', sourceVersion: 2 });
    mocks.commit.mockResolvedValue({ status: 'COMPLETED', operationId: 'canonical-op' });
    mocks.billingAllocationCount.mockResolvedValue(1);

    await expect(processFamilyBillingOutboxEvent('outbox-future-join')).resolves.toMatchObject({ processed: false, reason: 'NOT_YET_AVAILABLE' });
    expect(mocks.getSubscription).not.toHaveBeenCalled();
    event.availableAt = new Date(0);

    await expect(processFamilyBillingOutboxEvent('outbox-future-join')).resolves.toEqual({ processed: true });

    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      effectivePolicy: 'NEXT_CYCLE',
      effectiveDate: '2026-11-01',
      allocations: [expect.objectContaining({ enrollmentId: 'mat-future', validFrom: '2026-11-01' })],
    }));
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.getSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.materialize).toHaveBeenCalledWith(
      expect.objectContaining({ standaloneSubscriptionId: 'existing-sub' }),
      expect.objectContaining({ tx: expect.any(Object) }),
    );
  });

  it('não inicia commit do JOIN se perder o claim na barreira transacional', async () => {
    const event = {
      id: 'outbox-future-join', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-join',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 50, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-12-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-join',
        strategy: 'JOIN_EXISTING_CURRENT_CYCLE', targetStandaloneSubscriptionId: 'existing-sub',
        expectedBillingVersion: 2, previousMonthlyValue: 100, resultingMonthlyValue: 150,
        scheduledEffectiveAt: '2026-11-01T04:00:00.000Z', billingPhase: 'RECURRING',
      },
    };
    mocks.outboxFindUnique.mockResolvedValue(event);
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE', billingVersion: 2,
      matriculas: [{ id: 'mat-future', status: 'PENDENTE_TAXA', cobrarDurantePausa: false }],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([{
      id: 'allocation-future', matriculaId: 'mat-future', alunoId: 'student-1', amount: 50,
      baseAmount: 50, discountAmount: 0, competenceStart: new Date('2026-11-01T00:00:00Z'),
      competenceEnd: new Date('2026-11-30T00:00:00Z'), status: 'PENDING', sourceChargeId: null,
    }]);
    mocks.standaloneFindFirst.mockResolvedValue({ id: 'existing-sub', asaasSubscriptionId: 'asaas-existing' });
    mocks.getSubscription.mockResolvedValue({ value: 100, status: 'ACTIVE' });
    mocks.materialize.mockResolvedValue({ id: 'agreement-existing' });
    mocks.operationFindFirst.mockResolvedValue(null);
    mocks.preview.mockResolvedValue({ blockers: [], warnings: [], adjustments: [], previewHash: 'hash', expiresAt: '2026-11-01T05:00:00.000Z', sourceVersion: 2 });
    mocks.commit.mockImplementation(async (_input, guard) => {
      if (guard) await guard({ familyBillingOutbox: { updateMany: mocks.outboxUpdateMany } } as never);
      return { status: 'COMPLETED', operationId: 'canonical-op' };
    });
    let fencedUpdates = 0;
    mocks.outboxUpdateMany.mockImplementation(async () => {
      fencedUpdates += 1;
      return { count: fencedUpdates === 5 ? 0 : 1 };
    });

    const result = await processFamilyBillingOutboxEvent('outbox-future-join');

    expect(result).toMatchObject({ processed: false, reason: 'REQUIRES_RECONCILIATION' });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.familyAllocationUpdateMany).not.toHaveBeenCalled();
  });

  it('mantém a recorrência recuperável e sem retry quente quando todos estão pausados', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-future', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_RECURRING:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 2,
        monthlyValue: 300, enrollmentFeeValue: 0, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Matrícula familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'RECURRING',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE',
      matriculas: [
        { id: 'mat-1', status: 'PAUSADA', cobrarDurantePausa: false, dataRetornoPrevista: null },
        { id: 'mat-2', status: 'PAUSADA', cobrarDurantePausa: false, dataRetornoPrevista: null },
      ],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([
      { matriculaId: 'mat-1', amount: 150, status: 'PENDING', sourceChargeId: null },
      { matriculaId: 'mat-2', amount: 150, status: 'PENDING', sourceChargeId: null },
    ]);

    await expect(processFamilyBillingOutboxEvent('outbox-future')).resolves.toEqual({
      processed: false,
      reason: 'FAMILY_PAUSED',
    });

    const requeued = mocks.outboxUpdateMany.mock.calls.at(-1)?.[0];
    expect(requeued).toMatchObject({
      data: expect.objectContaining({
        status: 'PENDING',
        lastError: 'AGUARDANDO_RETORNO_DA_PAUSA_FAMILIAR',
      }),
    });
    expect(requeued.data.availableAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(mocks.createStandaloneCharge).not.toHaveBeenCalled();
  });

  it('cobra a taxa de matrícula de aluno pausado antes da vigência', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-fee', contaId: 'conta-1', aggregateId: 'family-1',
      aggregateType: 'MATRICULA_FAMILIAR', eventType: 'FUTURE_FAMILY_ENROLLMENT_FEE:operation-1',
      status: 'PENDING', attempts: 0, availableAt: new Date(0),
      payload: {
        aggregateType: 'MATRICULA_FAMILIAR', aggregateId: 'family-1', contaId: 'conta-1',
        responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
        monthlyValue: 0, enrollmentFeeValue: 100, billingType: 'BOLETO', cycle: 'MONTHLY',
        nextDueDate: '2026-11-01', endDate: '2027-10-31', enrollmentFeeDueDate: '2026-10-10',
        description: 'Taxa familiar', actorId: 'user-1', operationId: 'operation-1',
        strategy: 'SEPARATE', billingPhase: 'ENROLLMENT_FEE',
        deferActivationUntil: '2026-11-01T04:00:00.000Z',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.familyFindFirst.mockResolvedValue({
      status: 'PENDENTE',
      matriculas: [{ id: 'mat-paused', status: 'PAUSADA', cobrarDurantePausa: false, dataRetornoPrevista: null }],
    });
    mocks.familyAllocationFindMany.mockResolvedValue([
      { matriculaId: 'mat-paused', amount: 100, status: 'PENDING', sourceChargeId: null },
    ]);

    await expect(processFamilyBillingOutboxEvent('outbox-fee')).resolves.toEqual({ processed: true });

    expect(mocks.createStandaloneCharge).toHaveBeenCalledWith(expect.objectContaining({ value: 100 }));
    expect(mocks.familyAllocationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ chargeKind: 'TAXA_MATRICULA', matriculaId: { in: ['mat-paused'] } }),
    }));
    expect(mocks.enrollmentUpdateMany).not.toHaveBeenCalled();
  });
});

describe('REQUEST_SOURCE_SUBSCRIPTION_CLOSURE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-1', contaId: 'conta-1', aggregateId: 'renewal-1',
      eventType: 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE', status: 'PENDING', attempts: 0,
      payload: {
        contaId: 'conta-1', aggregateId: 'renewal-1', sourceFinancialAgreementId: 'standalone-1',
        sourceAsaasSubscriptionId: 'asaas-1', effectiveDate: '2026-08-31',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.standaloneFindFirst.mockResolvedValue({
      id: 'standalone-1', asaasSubscriptionId: 'asaas-1', familyGroupId: 'family-1',
    });
    mocks.standaloneUpdateMany.mockResolvedValue({ count: 1 });
    mocks.rematriculaUpdateMany.mockResolvedValue({ count: 1 });
    mocks.operationFindFirst.mockResolvedValue(null);
    mocks.adjustmentFindFirst.mockResolvedValue(null);
    mocks.materialize.mockResolvedValue({ id: 'agreement-1' });
    mocks.allocationFindMany.mockResolvedValue([{
      id: 'allocation-1', baseAmount: 150, discountAmount: 0, netAmount: 150,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    mocks.preview.mockResolvedValue({
      blockers: [], adjustments: [], previewHash: 'hash-1',
      expiresAt: '2099-01-01T00:00:00.000Z', sourceVersion: 3,
    });
    mocks.commit.mockResolvedValue({ status: 'COMPLETED', operationId: 'operation-1' });
  });

  it('atualiza somente a vigência e recupera commit concluído sem duplicar a operação', async () => {
    await expect(processFamilyBillingOutboxEvent('outbox-1')).resolves.toEqual({ processed: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'UPDATE_ALLOCATION',
      allocations: [expect.objectContaining({
        allocationId: 'allocation-1',
        validUntil: '2026-09-01',
        validFrom: expect.not.stringContaining('2026-01-01'),
      })],
    }));
    expect(mocks.commit).toHaveBeenCalledTimes(1);

    mocks.operationFindFirst.mockResolvedValue({ id: 'operation-1' });
    await expect(processFamilyBillingOutboxEvent('outbox-1')).resolves.toEqual({ processed: true });
    expect(mocks.materialize).toHaveBeenCalledTimes(1);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it('permite reconciliação explícita de evento que teve resultado incerto', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-1',
      contaId: 'conta-1',
      aggregateId: 'renewal-1',
      eventType: 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE',
      status: 'REQUIRES_RECONCILIATION',
      attempts: 1,
      payload: {
        contaId: 'conta-1',
        aggregateId: 'renewal-1',
        sourceFinancialAgreementId: 'standalone-1',
        sourceAsaasSubscriptionId: 'asaas-1',
        effectiveDate: '2026-08-31',
      },
    });

    await expect(
      processFamilyBillingOutboxEvent('outbox-1', { allowReconciliation: true }),
    ).resolves.toEqual({ processed: true });
    expect(mocks.outboxUpdateMany).toHaveBeenCalled();
  });
});
