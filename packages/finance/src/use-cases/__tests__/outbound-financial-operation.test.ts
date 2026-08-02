import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));
const upsertIssue = vi.hoisted(() => vi.fn());

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasIntegrationJob: db,
  },
}));
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: upsertIssue,
}));

import {
  confirmOutboundCreateByProviderEvent,
  markOutboundRemoteRequested,
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
      { id: 'job-match', payload },
      { id: 'job-other', payload: { ...payload, remoteId: 'pay-other', externalReference: 'other' } },
    ]);
    db.findUnique.mockResolvedValueOnce({ payload });
    db.update.mockResolvedValueOnce({ id: 'job-match' });

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
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-match' },
      data: expect.objectContaining({ status: 'DONE' }),
    }));
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
    db.findUnique.mockResolvedValueOnce({ payload });
    db.update.mockResolvedValueOnce({ id: 'job-1' });

    await markOutboundResultUnknown({
      jobId: 'job-1',
      contaId: 'tenant-a',
      resource: 'PAYMENT',
      entityId: 'charge-1',
      externalReference: payload.externalReference,
      error: new Error('timeout after POST'),
    });

    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSING', lastError: 'timeout after POST' }),
    }));
    expect(upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      severity: 'HIGH',
    }));
  });
});
