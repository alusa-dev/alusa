import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));
const upsertIssue = vi.hoisted(() => vi.fn());
const resolveIssue = vi.hoisted(() => vi.fn());

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasIntegrationJob: db,
  },
}));
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  buildFinanceReconciliationIssueDedupeKey: ({ entityType, entityId, issueType }: { entityType: string; entityId?: string | null; issueType: string }) =>
    `${issueType}:${entityType}:${entityId ?? 'unknown'}`,
  upsertFinanceReconciliationIssue: upsertIssue,
  resolveFinanceReconciliationIssueByDedupe: resolveIssue,
}));

import {
  confirmOutboundCreateByProviderEvent,
  markOutboundAwaitingWebhook,
  markOutboundRemoteRequested,
  markOutboundRequiresReconciliation,
  markOutboundResultUnknown,
  reserveOutboundFinancialOperation,
} from '../outbound-financial-operation';

const payload = {
  version: 1 as const,
  state: 'AWAITING_WEBHOOK' as const,
  resource: 'PAYMENT' as const,
  entityId: 'charge-1',
  externalReference: 'alusa:standalone:charge-1',
  correlationId: 'idem-1',
  requestFingerprint: 'fingerprint-1',
  remoteId: 'pay-1',
};

describe('outbound financial operation ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reserva a intenção com chave composta pelo tenant antes do I/O remoto', async () => {
    db.findUnique.mockResolvedValueOnce(null);
    db.upsert.mockResolvedValueOnce({ id: 'job-1', payload });

    await reserveOutboundFinancialOperation({
      contaId: 'tenant-a',
      type: 'CREATE_PAYMENT',
      idempotencyKey: 'idem-1',
      resource: 'PAYMENT',
      entityId: 'charge-1',
      externalReference: payload.externalReference,
      requestFingerprint: 'fingerprint-1',
      links: { chargeId: 'charge-1' },
    });

    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        uq_asaas_integration_job: {
          contaId: 'tenant-a',
          type: 'CREATE_PAYMENT',
          idempotencyKey: 'idem-1',
        },
      },
      create: expect.objectContaining({ contaId: 'tenant-a', chargeId: 'charge-1' }),
    }));
  });

  it('reserva CUSTOMER com identidade e chave isoladas por conta', async () => {
    db.findUnique.mockResolvedValue(null);
    db.upsert.mockImplementation(async (args: { create: { payload: unknown } }) => ({ id: 'job-customer', payload: args.create.payload }));

    await reserveOutboundFinancialOperation({
      contaId: 'tenant-a', type: 'CREATE_CUSTOMER', idempotencyKey: 'customer:tenant-a-key',
      resource: 'CUSTOMER', entityId: 'customer:tenant-a:RESPONSAVEL:r1', externalReference: 'alusa_tenant-a_responsavel_r1',
      requestFingerprint: 'fingerprint-a', metadata: { cpfCnpjFingerprint: 'document-a' },
    });
    await reserveOutboundFinancialOperation({
      contaId: 'tenant-b', type: 'CREATE_CUSTOMER', idempotencyKey: 'customer:tenant-b-key',
      resource: 'CUSTOMER', entityId: 'customer:tenant-b:RESPONSAVEL:r1', externalReference: 'alusa_tenant-b_responsavel_r1',
      requestFingerprint: 'fingerprint-b', metadata: { cpfCnpjFingerprint: 'document-b' },
    });

    expect(db.findUnique).toHaveBeenNthCalledWith(1, { where: { uq_asaas_integration_job: { contaId: 'tenant-a', type: 'CREATE_CUSTOMER', idempotencyKey: 'customer:tenant-a-key' } } });
    expect(db.findUnique).toHaveBeenNthCalledWith(2, { where: { uq_asaas_integration_job: { contaId: 'tenant-b', type: 'CREATE_CUSTOMER', idempotencyKey: 'customer:tenant-b-key' } } });
    expect(db.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ create: expect.objectContaining({ contaId: 'tenant-a', type: 'CREATE_CUSTOMER' }) }));
    expect(db.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ create: expect.objectContaining({ contaId: 'tenant-b', type: 'CREATE_CUSTOMER' }) }));
  });

  it('recusa reutilizar a chave idempotente com payload diferente', async () => {
    db.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      payload: { ...payload, requestFingerprint: 'other-fingerprint' },
    });

    await expect(reserveOutboundFinancialOperation({
      contaId: 'tenant-a',
      type: 'CREATE_PAYMENT',
      idempotencyKey: 'idem-1',
      resource: 'PAYMENT',
      entityId: 'charge-1',
      externalReference: payload.externalReference,
      requestFingerprint: 'fingerprint-1',
    })).rejects.toThrow('OUTBOUND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('webhook tardio conclui somente o job do tenant e recurso correspondentes', async () => {
    db.findMany.mockResolvedValueOnce([
      { id: 'job-match', status: 'PROCESSING', payload },
      { id: 'job-other', status: 'PROCESSING', payload: { ...payload, remoteId: 'pay-other', externalReference: 'other' } },
    ]);
    db.findUnique.mockResolvedValueOnce({ payload, status: 'PROCESSING' });
    db.updateMany.mockResolvedValueOnce({ count: 1 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-match', status: 'DONE' });

    const confirmed = await confirmOutboundCreateByProviderEvent({
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      remoteId: 'pay-1',
      externalReference: payload.externalReference,
      eventName: 'PAYMENT_CREATED',
    });

    expect(confirmed).toBe(1);
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a', type: 'CREATE_PAYMENT' }),
    }));
    expect(db.updateMany).toHaveBeenCalledTimes(1);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-match', status: 'PROCESSING', payload: { equals: payload } },
      data: expect.objectContaining({ status: 'DONE' }),
    }));
  });

  it('recupera timeout sem remoteId por externalReference e resolve a issue de incerteza', async () => {
    const timedOutPayload = {
      ...payload,
      state: 'RESULT_UNKNOWN' as const,
      remoteId: undefined,
      lastError: 'timeout after POST',
    };
    const synchronizedPayload = {
      ...timedOutPayload,
      state: 'SYNCHRONIZED' as const,
      remoteId: 'pay-recovered',
      webhookConfirmedAt: '2026-10-16T12:00:00.000Z',
      metadata: { confirmedByEvent: 'PAYMENT_CREATED' },
    };
    db.findMany.mockResolvedValueOnce([
      { id: 'job-timeout', status: 'PROCESSING', payload: timedOutPayload },
    ]);
    db.findUnique.mockResolvedValueOnce({ status: 'PROCESSING', payload: timedOutPayload });
    db.updateMany.mockResolvedValueOnce({ count: 1 });
    db.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'job-timeout', status: 'DONE', payload: synchronizedPayload,
    });

    const confirmed = await confirmOutboundCreateByProviderEvent({
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      remoteId: 'pay-recovered',
      externalReference: payload.externalReference,
      eventName: 'PAYMENT_CREATED',
    });

    expect(confirmed).toBe(1);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-timeout', status: 'PROCESSING', payload: { equals: timedOutPayload } },
      data: expect.objectContaining({
        status: 'DONE',
        payload: expect.objectContaining({
          state: 'SYNCHRONIZED',
          remoteId: 'pay-recovered',
        }),
      }),
    }));
    expect(resolveIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      dedupeKey: 'BILLING_OPERATION_UNCERTAIN:PAYMENT:charge-1',
    }));
  });

  it('mantém aberta a issue crítica quando a confirmação não remove REQUIRES_RECONCILIATION', async () => {
    const criticalPayload = { ...payload, state: 'REQUIRES_RECONCILIATION' as const };
    db.findMany.mockResolvedValueOnce([
      { id: 'job-critical', status: 'FAILED', payload: criticalPayload },
    ]);
    db.findUnique.mockResolvedValueOnce({ status: 'FAILED', payload: criticalPayload });
    db.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'job-critical', status: 'FAILED', payload: criticalPayload,
    });

    const confirmed = await confirmOutboundCreateByProviderEvent({
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      remoteId: 'pay-1',
      externalReference: payload.externalReference,
      eventName: 'PAYMENT_CREATED',
    });

    expect(confirmed).toBe(1);
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(resolveIssue).not.toHaveBeenCalled();
  });

  it('does not match a different provider resource by external reference after a remote ID is recorded', async () => {
    const criticalPayload = { ...payload, state: 'REQUIRES_RECONCILIATION' as const };
    db.findMany.mockResolvedValueOnce([
      { id: 'job-critical', status: 'FAILED', payload: criticalPayload },
    ]);

    const confirmed = await confirmOutboundCreateByProviderEvent({
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      remoteId: 'pay-different',
      externalReference: payload.externalReference,
      eventName: 'PAYMENT_CREATED',
    });

    expect(confirmed).toBe(0);
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(resolveIssue).not.toHaveBeenCalled();
  });

  it('preserves webhook terminal payload when its completion wins after the transition read', async () => {
    const webhookPayload = {
      ...payload,
      state: 'SYNCHRONIZED',
      webhookConfirmedAt: '2026-10-16T12:00:00.000Z',
      metadata: { confirmedByEvent: 'PAYMENT_CREATED' },
    };
    db.findUnique
      .mockResolvedValueOnce({ status: 'PROCESSING', payload: { ...payload, state: 'REMOTE_REQUESTED' } })
      .mockResolvedValueOnce({ status: 'DONE', payload: webhookPayload });
    db.updateMany.mockImplementationOnce(async (args: { where: { status: string } }) => {
      expect(args.where.status).toBe('PROCESSING');
      // Simulate the webhook committing between this caller's read and CAS.
      return { count: 0 };
    });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', status: 'DONE', payload: webhookPayload });

    const result = await markOutboundAwaitingWebhook('job-1', 'pay-1');

    expect(result).toMatchObject({ status: 'DONE', payload: webhookPayload });
    expect(db.updateMany).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('uses the payload snapshot in the CAS and does not downgrade a concurrent remote confirmation', async () => {
    const stale = { ...payload, state: 'REMOTE_REQUESTED' as const };
    const confirmed = { ...payload, state: 'REMOTE_CONFIRMED' as const, remoteId: 'pay-confirmed' };
    db.findUnique
      .mockResolvedValueOnce({ status: 'PROCESSING', payload: stale })
      .mockResolvedValueOnce({ status: 'PROCESSING', payload: confirmed });
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', status: 'PROCESSING', payload: confirmed });

    const result = await markOutboundResultUnknown({
      jobId: 'job-1', contaId: 'tenant-a', resource: 'PAYMENT', entityId: 'charge-1',
      externalReference: payload.externalReference, error: new Error('stale timeout'),
    });

    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1', status: 'PROCESSING', payload: { equals: stale } },
    }));
    expect(result).toMatchObject({ payload: confirmed });
    expect(upsertIssue).not.toHaveBeenCalled();
  });

  it.each([
    ['result unknown', markOutboundResultUnknown],
    ['requires reconciliation', markOutboundRequiresReconciliation],
  ])('does not create a stale issue when %s loses to terminal synchronization', async (_label, mark) => {
    const synchronized = { ...payload, state: 'SYNCHRONIZED' as const, webhookConfirmedAt: '2026-10-16T12:00:00.000Z' };
    db.findUnique
      .mockResolvedValueOnce({ status: 'PROCESSING', payload: { ...payload, state: 'REMOTE_REQUESTED' } })
      .mockResolvedValueOnce({ status: 'DONE', payload: synchronized });
    db.updateMany.mockResolvedValueOnce({ count: 0 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', status: 'DONE', payload: synchronized });

    const result = await mark({
      jobId: 'job-1', contaId: 'tenant-a', resource: 'PAYMENT', entityId: 'charge-1',
      externalReference: payload.externalReference, error: new Error('stale failure'),
    });

    expect(result).toMatchObject({ status: 'DONE', payload: synchronized });
    expect(upsertIssue).not.toHaveBeenCalled();
  });

  it('permite que apenas um concorrente adquira o POST remoto', async () => {
    db.findUnique.mockResolvedValue({ payload: { ...payload, state: 'INTENT_CREATED' } });
    db.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(markOutboundRemoteRequested('job-1')).resolves.toBe(true);
    await expect(markOutboundRemoteRequested('job-1')).resolves.toBe(false);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PROCESSING', attempts: { increment: 1 } }),
    }));
  });

  it('resultado ambíguo vira pendência auditável sem apagar a intenção', async () => {
    db.findUnique.mockResolvedValueOnce({ payload: { ...payload, state: 'REMOTE_REQUESTED' }, status: 'PROCESSING' });
    db.updateMany.mockResolvedValueOnce({ count: 1 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1' });

    await markOutboundResultUnknown({
      jobId: 'job-1',
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      entityId: 'charge-1',
      externalReference: payload.externalReference,
      error: new Error('timeout after POST'),
    });

    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSING', lastError: 'timeout after POST' }),
    }));
    expect(upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      severity: 'HIGH',
    }));
  });

  it('preserves REQUIRES_RECONCILIATION when a stale result-unknown writer arrives', async () => {
    const requiresReconciliation = { ...payload, state: 'REQUIRES_RECONCILIATION' as const };
    db.findUnique.mockResolvedValueOnce({ payload: requiresReconciliation, status: 'FAILED' });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', payload: requiresReconciliation, status: 'FAILED' });

    const result = await markOutboundResultUnknown({
      jobId: 'job-1', contaId: 'tenant-a', resource: 'PAYMENT', entityId: 'charge-1',
      externalReference: payload.externalReference, error: new Error('late timeout'),
    });

    expect(result).toMatchObject({ status: 'FAILED', payload: { state: 'REQUIRES_RECONCILIATION' } });
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(upsertIssue).not.toHaveBeenCalled();
  });

  it('resolves a stale issue when webhook synchronization lands after issue upsert', async () => {
    const synchronized = { ...payload, state: 'SYNCHRONIZED' as const, webhookConfirmedAt: '2026-10-16T12:00:00.000Z' };
    db.findUnique
      .mockResolvedValueOnce({ status: 'PROCESSING', payload: { ...payload, state: 'REMOTE_REQUESTED' } })
      .mockResolvedValueOnce({ contaId: 'tenant-a', status: 'DONE', payload: synchronized });
    db.updateMany.mockResolvedValueOnce({ count: 1 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', contaId: 'tenant-a', status: 'PROCESSING', payload: { ...payload, state: 'RESULT_UNKNOWN' } });

    await markOutboundResultUnknown({
      jobId: 'job-1', contaId: 'tenant-a', resource: 'PAYMENT', entityId: 'charge-1',
      externalReference: payload.externalReference, error: new Error('timeout'),
    });

    expect(upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ severity: 'HIGH' }));
    expect(db.findUnique).toHaveBeenLastCalledWith({
      where: { id: 'job-1' }, select: { contaId: true, status: true, payload: true },
    });
    expect(resolveIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a', dedupeKey: 'BILLING_OPERATION_UNCERTAIN:PAYMENT:charge-1',
    }));
  });

  it('confirmação remota divergente bloqueia o job e cria issue CRITICAL', async () => {
    db.findUnique.mockResolvedValueOnce({ payload: { ...payload, state: 'REMOTE_REQUESTED' }, status: 'PROCESSING' });
    db.updateMany.mockResolvedValueOnce({ count: 1 });
    db.findUniqueOrThrow.mockResolvedValueOnce({ id: 'job-1', status: 'FAILED' });

    await markOutboundRequiresReconciliation({
      jobId: 'job-1',
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      entityId: 'charge-1',
      externalReference: payload.externalReference,
      error: 'REMOTE_PAYMENT_CONFIRMATION_MISMATCH',
    });

    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        payload: expect.objectContaining({
          state: 'REQUIRES_RECONCILIATION',
          lastError: 'REMOTE_PAYMENT_CONFIRMATION_MISMATCH',
        }),
      }),
    }));
    expect(upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      severity: 'CRITICAL',
      localStatus: 'REQUIRES_RECONCILIATION',
    }));
  });
});
