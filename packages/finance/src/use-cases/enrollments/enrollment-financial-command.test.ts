import { describe, expect, it, vi } from 'vitest';
import { MatriculaBillingOutboxStatus } from '@prisma/client';
import { enqueueEnrollmentFinancialCommand, processEnrollmentFinancialCommand, type EnrollmentFinancialCommand } from './enrollment-financial-command';
const { syncEditableSubscriptionPayments } = vi.hoisted(() => ({ syncEditableSubscriptionPayments: vi.fn().mockResolvedValue({ failed: 0 }) }));
vi.mock('./subscription-pending-payments-sync', () => ({ syncEditableSubscriptionPayments }));

const command: EnrollmentFinancialCommand = {
  version: 1,
  commandId: 'command-1',
  actorId: 'user-1',
  matriculaId: 'mat-1',
  targetSubscriptionId: 'asaas-sub-1',
  affectedMatriculaIds: ['mat-1'],
  remotePatch: { value: 150 },
  localPatch: { planoId: 'plan-2' },
  snapshot: { value: 150 },
};

describe('enqueueEnrollmentFinancialCommand', () => {
  function createTx() {
    let persisted: Record<string, unknown> | null = null;
    const tx = {
      matriculaBillingOutbox: {
        findFirst: vi.fn(async () => persisted),
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          if (persisted) return { count: 0 };
          persisted = { id: 'event-1', ...data[0] };
          return { count: 1 };
        }),
      },
      matricula: { findMany: vi.fn().mockResolvedValue([{ id: 'mat-1' }]) },
      matriculaLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return tx;
  }

  it('converge numa inserção atômica e rejeita a reutilização da chave com outro payload', async () => {
    const tx = createTx();
    const input = {
      contaId: 'conta-1', actorId: 'user-1', dedupeKey: 'edit-1',
      command: {
        matriculaId: 'mat-1', targetSubscriptionId: 'asaas-sub-1', affectedMatriculaIds: ['mat-1'],
        remotePatch: { value: 150 }, localPatch: { planoId: 'plan-2' },
      },
    };
    const created = await enqueueEnrollmentFinancialCommand(tx as never, input);
    expect(created.id).toBe('event-1');
    expect(tx.matriculaBillingOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    await expect(enqueueEnrollmentFinancialCommand(tx as never, {
      ...input,
      actorId: 'user-2',
      command: { ...input.command, remotePatch: { value: 175 } },
    })).rejects.toThrow('ENROLLMENT_FINANCIAL_COMMAND_DEDUPE_CONFLICT');
    expect(tx.matriculaBillingOutbox.createMany).toHaveBeenCalledTimes(1);
  });

  it('valida o vencedor de uma corrida de INSERT ... ON CONFLICT sem descartar a transação', async () => {
    let racedPayload: Record<string, unknown> | null = null;
    const tx = {
      matriculaBillingOutbox: {
        findFirst: vi.fn(async () => racedPayload ? { id: 'winner', payload: racedPayload.payload } : null),
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          racedPayload = { payload: { ...(data[0]?.payload as object), actorId: 'other-actor' } };
          return { count: 0 };
        }),
      },
      matricula: { findMany: vi.fn().mockResolvedValue([{ id: 'mat-1' }]) },
      matriculaLog: { create: vi.fn() },
    };
    const input = {
      contaId: 'conta-1', actorId: 'user-1', dedupeKey: 'racing-edit',
      command: {
        matriculaId: 'mat-1', targetSubscriptionId: 'asaas-sub-1', affectedMatriculaIds: ['mat-1'],
        remotePatch: { value: 150 }, localPatch: { planoId: 'plan-2' },
      },
    };
    await expect(enqueueEnrollmentFinancialCommand(tx as never, input)).resolves.toMatchObject({ id: 'winner' });
    expect(tx.matriculaBillingOutbox.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rejeita o vencedor concorrente se a mesma chave representa outro payload financeiro', async () => {
    let racedPayload: Record<string, unknown> | null = null;
    const tx = {
      matriculaBillingOutbox: {
        findFirst: vi.fn(async () => racedPayload ? { id: 'winner', payload: racedPayload.payload } : null),
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          racedPayload = { payload: { ...(data[0]?.payload as object), remotePatch: { value: 999 } } };
          return { count: 0 };
        }),
      },
      matricula: { findMany: vi.fn().mockResolvedValue([{ id: 'mat-1' }]) },
      matriculaLog: { create: vi.fn() },
    };
    await expect(enqueueEnrollmentFinancialCommand(tx as never, {
      contaId: 'conta-1', actorId: 'user-1', dedupeKey: 'racing-conflict',
      command: { matriculaId: 'mat-1', targetSubscriptionId: 'asaas-sub-1', affectedMatriculaIds: ['mat-1'], remotePatch: { value: 150 }, localPatch: { planoId: 'plan-2' } },
    })).rejects.toThrow('ENROLLMENT_FINANCIAL_COMMAND_DEDUPE_CONFLICT');
  });
});

function baseDb(overrides: Record<string, unknown> = {}) {
  const tx = {
    matriculaBillingOutbox: {
      findFirst: vi.fn().mockResolvedValue({ id: 'event-1', terminalIntent: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    billingAllocation: { findMany: vi.fn().mockResolvedValue([{ id: 'allocation-1' }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    billingAgreement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    matriculaLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    matricula: {
      findMany: vi.fn().mockResolvedValue([{ id: 'mat-1' }]),
    },
    billingAgreement: { findFirst: vi.fn().mockResolvedValue({ id: 'agreement-1' }) },
    matriculaBillingOutbox: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    ...overrides,
  };
  return { db, tx };
}

describe('processEnrollmentFinancialCommand', () => {
  it('rejeita assinatura sem vínculo tenant-safe antes de chamar Asaas', async () => {
    const { db } = baseDb({ billingAgreement: { findFirst: vi.fn().mockResolvedValue(null) } });
    const get = vi.fn();
    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: command },
      claimToken: 'claim-1', now: new Date('2026-10-10T12:00:00Z'), remote: { get: get as never, update: vi.fn() as never },
    });

    expect(get).not.toHaveBeenCalled();
    expect(result.status).toBe(MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION);
  });

  it('mantém o comando retryable se Asaas atualizou e a projeção local falhou', async () => {
    const { db } = baseDb();
    db.$transaction
      .mockImplementationOnce(async () => { throw new Error('DB_PROJECTION_FAILED'); })
      .mockImplementationOnce(async (callback: (value: never) => unknown) => callback({
        matriculaBillingOutbox: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        matriculaLog: { create: vi.fn().mockResolvedValue({}) },
      } as never));
    const remoteState = { value: 100, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE' };
    const get = vi.fn(async () => ({ ...remoteState } as never));
    const update = vi.fn(async (_id: string, patch: { value?: number }) => { remoteState.value = patch.value ?? remoteState.value; });

    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: command },
      claimToken: 'claim-1', now: new Date('2026-10-10T12:00:00Z'), remote: { get: get as never, update: update as never },
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(MatriculaBillingOutboxStatus.FAILED);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('revalida a lease depois da leitura remota e antes de atualizar a assinatura', async () => {
    const { db } = baseDb();
    const remoteState = { value: 100, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE' };
    const get = vi.fn(async () => ({ ...remoteState } as never));
    const update = vi.fn();
    const assertLeaseOwned = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('ENROLLMENT_FINANCIAL_COMMAND_LEASE_LOST'));

    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: command },
      claimToken: 'claim-1', now: new Date('2026-10-10T12:00:00Z'), remote: { get: get as never, update: update as never },
      assertLeaseOwned,
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(assertLeaseOwned).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(result.status).toBe(MatriculaBillingOutboxStatus.FAILED);
  });

  it('recusa payload inválido antes de qualquer efeito remoto', async () => {
    const { db } = baseDb();
    const get = vi.fn();
    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: { ...command, version: 2 } },
      claimToken: 'claim-1', now: new Date(), remote: { get: get as never, update: vi.fn() as never },
    });
    expect(get).not.toHaveBeenCalled();
    expect(result.status).toBe(MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION);
  });

  it('preserva termos omitidos e sincroniza zero enviado explicitamente', async () => {
    syncEditableSubscriptionPayments.mockClear();
    const financialCommand = {
      ...command,
      remotePatch: { fine: { value: 0, type: 'FIXED' as const }, updatePendingPayments: true },
      localPatch: { multaPercentual: null, multaTipo: null },
      snapshot: { fineValue: 0, fineType: null },
    };
    const { db, tx } = baseDb();
    const remoteState = { value: 150, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE', interest: { value: 6 }, discount: { value: 10, type: 'PERCENTAGE', dueDateLimitDays: 5 }, fine: { value: 2, type: 'FIXED' } };
    const get = vi.fn(async () => structuredClone(remoteState) as never);
    const update = vi.fn(async (_id: string, patch: { fine?: { value: number; type: 'FIXED' } }) => { if (patch.fine) remoteState.fine = { ...patch.fine }; });

    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: financialCommand },
      claimToken: 'claim-1', now: new Date(), remote: { get: get as never, update: update as never },
    });

    expect(result.status).toBe(MatriculaBillingOutboxStatus.PROCESSED);
    expect(get).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith('asaas-sub-1', { fine: { value: 0, type: 'FIXED' }, updatePendingPayments: true }, { contaId: 'conta-1' });
    expect(syncEditableSubscriptionPayments).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasSubscriptionId: 'asaas-sub-1',
      terms: { fine: { value: 0, type: 'FIXED' } },
    });
    expect(tx.matricula.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { multaPercentual: null, multaTipo: null } }));
    expect(tx.matricula.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ jurosMensal: expect.anything(), descontoAntecipado: expect.anything(), billingProvisionStatus: expect.anything() }) }));
  });

  it('atualiza alocação SCHEDULED futura in place sem ativar nem encerrar a vigência', async () => {
    const futureValidFrom = new Date('2026-11-01T00:00:00.000Z');
    const { db, tx } = baseDb();
    tx.billingAllocation.findMany.mockResolvedValue([{
      id: 'allocation-future',
      contaId: 'conta-1',
      agreementId: 'agreement-1',
      matriculaId: 'mat-1',
      alunoId: 'student-1',
      sourceChargeId: null,
      kind: 'TUITION',
      status: 'SCHEDULED',
      recurring: true,
      baseAmount: 100,
      discountAmount: 0,
      netAmount: 100,
      validFrom: futureValidFrom,
      validUntil: null,
      prorationPolicy: 'NEXT_CYCLE',
      metadata: null,
    }] as never);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    tx.billingAllocation.updateMany = updateMany;
    const create = vi.fn();
    tx.billingAllocation.create = create;
    const remoteState = { value: 100, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE' };
    const get = vi.fn(async () => ({ ...remoteState } as never));
    const update = vi.fn(async (_id: string, patch: { value?: number }) => { remoteState.value = patch.value ?? remoteState.value; });

    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: {
        id: 'event-future',
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        attempts: 1,
        payload: {
          ...command,
          remotePatch: { value: 120 },
          localPatch: { vencimentoDia: 10 },
          allocationValues: [{ matriculaId: 'mat-1', value: 120 }],
        },
      },
      claimToken: 'claim-future',
      now: new Date('2026-10-10T12:00:00.000Z'),
      remote: { get: get as never, update: update as never },
    });

    expect(result.status).toBe(MatriculaBillingOutboxStatus.PROCESSED);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'allocation-future', contaId: 'conta-1', status: 'SCHEDULED', validFrom: futureValidFrom },
      data: { baseAmount: 120, discountAmount: 0, netAmount: 120 },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('registra a oitava tentativa como reconciliação e não deixa o evento preso em FAILED', async () => {
    const { db } = baseDb();
    const get = vi.fn().mockRejectedValue(new Error('timeout provider'));
    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 8, payload: command },
      claimToken: 'claim-1', now: new Date(), remote: { get: get as never, update: vi.fn() as never },
    });
    expect(result.status).toBe(MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION);
  });

  it('encaminha para finishTerminalIntent quando o cancelamento concorre com a atualização remota', async () => {
    const { db, tx } = baseDb({
      matriculaBillingOutbox: {
        findFirst: vi.fn().mockResolvedValue({ terminalIntent: 'CANCELADA', terminalIntentReason: 'user-request', terminalIntentActorId: 'user-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
    tx.matriculaBillingOutbox.findFirst.mockResolvedValue({ id: 'event-1', terminalIntent: 'CANCELADA' });
    const finishTerminalIntent = vi.fn().mockResolvedValue({ status: 'CANCELLED' });
    const remoteState = { value: 100, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: null, status: 'ACTIVE' };
    const update = vi.fn(async (_id: string, patch: { value?: number }) => { remoteState.value = patch.value ?? remoteState.value; });

    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: command },
      claimToken: 'claim-1', now: new Date(), remote: { get: vi.fn(async () => ({ ...remoteState } as never)) as never, update: update as never },
      finishTerminalIntent,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(finishTerminalIntent).toHaveBeenCalledWith({ intent: 'CANCELADA', reason: 'user-request', actorId: 'user-1' });
    expect(result).toEqual({ status: 'CANCELLED' });
  });

  it('escopa allocationValidity ao agreement da assinatura alvo e valida todas as linhas alteradas', async () => {
    const financialCommand = {
      ...command,
      remotePatch: { endDate: '2027-10-31' },
      localPatch: { dataFimContrato: '2027-10-31T00:00:00.000Z' },
      allocationValidity: { matriculaIds: ['mat-1'], validUntil: '2027-10-31' },
    };
    const { db, tx } = baseDb();
    const remoteState = { value: 150, cycle: 'MONTHLY', nextDueDate: '2026-11-01', endDate: '2027-10-31', status: 'ACTIVE' };
    const result = await processEnrollmentFinancialCommand({
      db: db as never,
      event: { id: 'event-1', contaId: 'conta-1', matriculaId: 'mat-1', attempts: 1, payload: financialCommand },
      claimToken: 'claim-1', now: new Date(), remote: { get: vi.fn(async () => ({ ...remoteState } as never)) as never, update: vi.fn() as never },
    });
    expect(result.status).toBe(MatriculaBillingOutboxStatus.PROCESSED);
    expect(tx.billingAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1',
        agreement: { contaId: 'conta-1', asaasSubscriptionId: 'asaas-sub-1' },
        matriculaId: { in: ['mat-1'] },
      }),
    }));
    expect(tx.billingAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agreement: { contaId: 'conta-1', asaasSubscriptionId: 'asaas-sub-1' }, id: { in: ['allocation-1'] } }),
      data: { validUntil: new Date('2027-10-31T00:00:00.000Z') },
    }));
  });
});
