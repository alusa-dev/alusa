import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db = {
    asaasIntegrationJob: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return {
    db,
    withIdempotencyGuard: vi.fn(async ({ fn }: { fn: (tx: typeof db) => Promise<unknown> }) => fn(db)),
  };
});

vi.mock('@alusa/database', () => ({ prisma: mocks.db }));
vi.mock('../../core/idempotency.service', () => ({ withIdempotencyGuard: mocks.withIdempotencyGuard }));

vi.mock('../../realtime/finance-realtime-publisher', () => ({
  publishFinanceEvent: vi.fn(async () => undefined),
}));

vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: vi.fn(async () => undefined),
}));

import { prisma } from '@alusa/database';
import { publishFinanceEvent } from '../../realtime/finance-realtime-publisher';
import { upsertFinanceReconciliationIssue } from '../../reconciliation/finance-reconciliation-issue.service';
import {
  confirmPaymentCommandsByProviderEvent,
  expectedEventsForPaymentCommand,
  claimPaymentCommandForDispatch,
  claimPaymentRefundCommandForDispatch,
  markPaymentCommandSent,
  markPaymentCommandNeedsReconciliation,
  markStalePaymentCommandsForReconciliation,
  findActivePaymentRefundCommand,
  registerPaymentCommand,
} from '../payment-command-ledger';

describe('payment-command-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra comando de pagamento com chave idempotente por conta/tipo/correlationId', async () => {
    vi.mocked(prisma.asaasIntegrationJob.upsert).mockResolvedValueOnce({
      id: 'job-1',
      payload: {
        commandStatus: 'REQUESTED',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: expectedEventsForPaymentCommand('PAYMENT_REFUND_COMMAND'),
      },
    } as never);

    await registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasPaymentId: 'pay-1',
      expectedEvents: expectedEventsForPaymentCommand('PAYMENT_REFUND_COMMAND'),
      correlationId: 'corr-1',
      actorId: 'user-1',
      chargeId: 'chg-1',
      metadata: { refundValue: 10 },
    });

    expect(prisma.asaasIntegrationJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        uq_asaas_integration_job: {
          contaId: 'conta-1',
          type: 'PAYMENT_REFUND_COMMAND',
          idempotencyKey: 'corr-1',
        },
      },
      create: expect.objectContaining({
        contaId: 'conta-1',
        type: 'PAYMENT_REFUND_COMMAND',
        status: 'PENDING',
        idempotencyKey: 'corr-1',
        chargeId: 'chg-1',
      }),
    }));
  });

  it('marca comando como enviado ao Asaas sem confirmar estado financeiro final', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      payload: {
        commandStatus: 'REQUESTED',
        commandType: 'PAYMENT_CANCEL_COMMAND',
        entityType: 'COBRANCA',
        entityId: 'cob-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_DELETED'],
        correlationId: 'corr-1',
        requestedAt: '2026-06-07T00:00:00.000Z',
      },
    } as never);
    vi.mocked(prisma.asaasIntegrationJob.update).mockResolvedValueOnce({ id: 'job-1' } as never);

    await markPaymentCommandSent({ jobId: 'job-1', providerStatus: 'PENDING' });

    expect(prisma.asaasIntegrationJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: 'PROCESSING',
        payload: expect.objectContaining({
          commandStatus: 'SENT_TO_ASAAS',
          providerStatus: 'PENDING',
        }),
      }),
    }));
  });

  it('permite apenas um claim atômico entre duas chamadas concorrentes', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockResolvedValue({
      payload: {
        commandStatus: 'REQUESTED', commandType: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE',
        entityId: 'chg-1', asaasPaymentId: 'pay-1', expectedEvents: ['PAYMENT_REFUNDED'], correlationId: 'corr-1',
      },
    } as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);

    const claims = await Promise.all([
      claimPaymentCommandForDispatch({ contaId: 'tenant-a', jobId: 'job-1', providerStatus: 'RECEIVED' }),
      claimPaymentCommandForDispatch({ contaId: 'tenant-a', jobId: 'job-1', providerStatus: 'RECEIVED' }),
    ]);

    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'job-1', contaId: 'tenant-a', payload: { path: ['commandStatus'], equals: 'REQUESTED' },
      }),
    }));
  });

  it('marca timeout/resultado ambíguo para reconciliação e bloqueia novo POST', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      contaId: 'conta-1',
      payload: {
        commandStatus: 'SENT_TO_ASAAS', commandType: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE',
        entityId: 'chg-1', asaasPaymentId: 'pay-1', expectedEvents: ['PAYMENT_REFUNDED'], correlationId: 'corr-1',
      },
    } as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    await markPaymentCommandNeedsReconciliation({ jobId: 'job-1', error: new Error('request timeout') });

    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', contaId: 'conta-1', payload: { path: ['commandStatus'], equals: 'SENT_TO_ASAAS' } }),
      data: expect.objectContaining({
        status: 'FAILED',
        payload: expect.objectContaining({
          commandStatus: 'NEEDS_RECONCILIATION',
          metadata: expect.objectContaining({ ambiguousOutcome: true, failureMessage: 'request timeout' }),
        }),
      }),
    }));
    expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', entityType: 'CHARGE', entityId: 'chg-1', asaasId: 'pay-1',
    }));
  });

  it('does not downgrade a webhook confirmation when reconciliation marking loses the race', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique)
      .mockResolvedValueOnce({
        id: 'job-1', contaId: 'conta-1', payload: {
          commandStatus: 'SENT_TO_ASAAS', commandType: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE',
          entityId: 'chg-1', asaasPaymentId: 'pay-1', expectedEvents: ['PAYMENT_REFUNDED'], correlationId: 'corr-1',
        },
      } as never)
      .mockResolvedValueOnce({ payload: {
        commandStatus: 'CONFIRMED_BY_WEBHOOK', commandType: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE',
        entityId: 'chg-1', asaasPaymentId: 'pay-1', expectedEvents: ['PAYMENT_REFUNDED'], correlationId: 'corr-1',
      } } as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const result = await markPaymentCommandNeedsReconciliation({ jobId: 'job-1', error: new Error('timeout') });

    expect(result).toEqual({ id: 'job-1', status: 'CONFIRMED_BY_WEBHOOK' });
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ payload: { path: ['commandStatus'], equals: 'SENT_TO_ASAAS' } }),
    }));
    expect(upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
    expect(publishFinanceEvent).not.toHaveBeenCalled();
  });

  it('finds only active refund commands within the requested tenant and payment', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockResolvedValueOnce({
      id: 'job-active', payload: {
        commandStatus: 'NEEDS_RECONCILIATION', commandType: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE',
        entityId: 'chg-1', asaasPaymentId: 'pay-1', expectedEvents: ['PAYMENT_REFUNDED'], correlationId: 'corr-active',
      },
    } as never);

    const active = await findActivePaymentRefundCommand({ contaId: 'tenant-a', asaasPaymentId: 'pay-1' });

    expect(active).toEqual({ id: 'job-active', correlationId: 'corr-active', commandStatus: 'NEEDS_RECONCILIATION' });
    expect(prisma.asaasIntegrationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'tenant-a',
        type: 'PAYMENT_REFUND_COMMAND',
        AND: expect.arrayContaining([
          { payload: { path: ['asaasPaymentId'], equals: 'pay-1' } },
          { OR: [
            { payload: { path: ['commandStatus'], equals: 'REQUESTED' } },
            { payload: { path: ['commandStatus'], equals: 'SENT_TO_ASAAS' } },
            { payload: { path: ['commandStatus'], equals: 'NEEDS_RECONCILIATION' } },
          ] },
        ]),
      }),
    }));
  });

  it('claims only one command when the same payment has concurrent requests with different keys', async () => {
    const requestCommand = (id: string, correlationId: string, commandStatus: string) => ({
      id,
      payload: {
        commandStatus,
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
        correlationId,
      },
    });
    vi.mocked(prisma.asaasIntegrationJob.findMany)
      .mockResolvedValueOnce([requestCommand('job-a', 'key-a', 'REQUESTED'), requestCommand('job-b', 'key-b', 'REQUESTED')] as never)
      .mockResolvedValueOnce([requestCommand('job-a', 'key-a', 'SENT_TO_ASAAS'), requestCommand('job-b', 'key-b', 'REQUESTED')] as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    const winner = await claimPaymentRefundCommandForDispatch({ contaId: 'tenant-a', jobId: 'job-a', asaasPaymentId: 'pay-1' });
    const loser = await claimPaymentRefundCommandForDispatch({ contaId: 'tenant-a', jobId: 'job-b', asaasPaymentId: 'pay-1' });

    expect(winner.claimed).toBe(true);
    expect(loser).toMatchObject({ claimed: false, activeCommand: { id: 'job-a', correlationId: 'key-a' } });
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'job-b', payload: { path: ['commandStatus'], equals: 'REQUESTED' } }),
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('does not consider confirmed or terminally failed refunds active', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockResolvedValueOnce(null);

    await expect(findActivePaymentRefundCommand({ contaId: 'tenant-a', asaasPaymentId: 'pay-1' })).resolves.toBeNull();
    expect(prisma.asaasIntegrationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          { payload: { path: ['asaasPaymentId'], equals: 'pay-1' } },
          { OR: [
            { payload: { path: ['commandStatus'], equals: 'REQUESTED' } },
            { payload: { path: ['commandStatus'], equals: 'SENT_TO_ASAAS' } },
            { payload: { path: ['commandStatus'], equals: 'NEEDS_RECONCILIATION' } },
          ] },
        ],
      }),
    }));
  });

  it('repetição da mesma chave preserva comando já enviado', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      status: 'PROCESSING',
      payload: {
        commandStatus: 'SENT_TO_ASAAS',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
        requestFingerprint: '{"value":10,"splitRefunds":[]}',
      },
    } as never);

    const result = await registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasPaymentId: 'pay-1',
      expectedEvents: ['PAYMENT_REFUNDED'],
      correlationId: 'corr-1',
      requestFingerprint: '{"value":10,"splitRefunds":[]}',
    });

    expect(result).toMatchObject({ id: 'job-1', status: 'PROCESSING' });
    expect(prisma.asaasIntegrationJob.upsert).not.toHaveBeenCalled();
  });

  it('rejeita reutilização da chave para payload diferente', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      payload: {
        commandStatus: 'REQUESTED',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
      },
    } as never);

    await expect(registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-2',
      asaasPaymentId: 'pay-1',
      expectedEvents: ['PAYMENT_REFUNDED'],
      correlationId: 'corr-1',
    })).rejects.toThrow('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('rejeita a mesma chave de estorno quando valor ou splits mudam no fingerprint', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      id: 'job-1',
      payload: {
        commandStatus: 'REQUESTED',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
        requestFingerprint: JSON.stringify({ value: 25, splitRefunds: [['wallet-a', 25]] }),
      },
    } as never);

    await expect(registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasPaymentId: 'pay-1',
      expectedEvents: ['PAYMENT_REFUNDED'],
      correlationId: 'corr-1',
      requestFingerprint: JSON.stringify({ value: 30, splitRefunds: [['wallet-a', 30]] }),
    })).rejects.toThrow('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('reproduz com segurança um comando legado pelo fingerprint derivado dos metadados existentes', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      id: 'legacy-job',
      status: 'PROCESSING',
      payload: {
        commandStatus: 'SENT_TO_ASAAS',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
        metadata: {
          refundValue: 25,
          splitRefunds: [{ id: 'wallet-b', value: 5 }, { id: 'wallet-a', value: 20 }],
        },
      },
    } as never);

    await expect(registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasPaymentId: 'pay-1',
      expectedEvents: ['PAYMENT_REFUNDED'],
      correlationId: 'legacy-key',
      requestFingerprint: JSON.stringify({ value: 25, splitRefunds: [['wallet-a', 20], ['wallet-b', 5]] }),
    })).resolves.toMatchObject({ id: 'legacy-job', status: 'PROCESSING' });

    expect(prisma.asaasIntegrationJob.upsert).not.toHaveBeenCalled();
  });

  it('falha fechado para comando legado sem metadados suficientes para comparar o payload', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({
      id: 'legacy-job',
      payload: {
        commandStatus: 'FAILED',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
      },
    } as never);

    await expect(registerPaymentCommand({
      contaId: 'conta-1',
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasPaymentId: 'pay-1',
      expectedEvents: ['PAYMENT_REFUNDED'],
      correlationId: 'legacy-key',
      requestFingerprint: JSON.stringify({ value: 25, splitRefunds: [] }),
    })).rejects.toThrow('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  });

  it('confirma comandos pendentes quando webhook/sync traz evento esperado', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([
      {
        id: 'job-1',
        contaId: 'conta-1',
        status: 'PROCESSING',
        payload: {
          commandStatus: 'SENT_TO_ASAAS',
          commandType: 'PAYMENT_CANCEL_COMMAND',
          entityType: 'CHARGE',
          entityId: 'chg-1',
          asaasPaymentId: 'pay-1',
          expectedEvents: ['PAYMENT_DELETED'],
          correlationId: 'corr-1',
          requestedAt: '2026-06-07T00:00:00.000Z',
        },
      },
    ] as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({ id: 'job-1' } as never);

    const result = await confirmPaymentCommandsByProviderEvent({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
      eventName: 'PAYMENT_DELETED',
      providerStatus: 'DELETED',
    });

    expect(result).toHaveLength(1);
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', contaId: 'conta-1', payload: { path: ['commandStatus'], equals: 'SENT_TO_ASAAS' } }),
      data: expect.objectContaining({
        status: 'DONE',
        payload: expect.objectContaining({
          commandStatus: 'CONFIRMED_BY_WEBHOOK',
          lastObservedEvent: 'PAYMENT_DELETED',
          providerStatus: 'DELETED',
        }),
      }),
    }));
    expect(publishFinanceEvent).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      type: 'finance.command.updated',
      entityId: 'chg-1',
      commandType: 'PAYMENT_CANCEL_COMMAND',
      commandStatus: 'CONFIRMED_BY_WEBHOOK',
    }));
  });

  it('confirma um webhook tardio para refund que já estava em reconciliação', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([{
      id: 'job-refund-reconciliation',
      contaId: 'conta-1',
      status: 'FAILED',
      payload: {
        commandStatus: 'NEEDS_RECONCILIATION',
        commandType: 'PAYMENT_REFUND_COMMAND',
        entityType: 'CHARGE',
        entityId: 'chg-1',
        asaasPaymentId: 'pay-1',
        expectedEvents: ['PAYMENT_REFUNDED'],
        correlationId: 'corr-1',
      },
    }] as never);
    vi.mocked(prisma.asaasIntegrationJob.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.asaasIntegrationJob.findUnique).mockResolvedValueOnce({ id: 'job-refund-reconciliation' } as never);

    const result = await confirmPaymentCommandsByProviderEvent({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', eventName: 'PAYMENT_REFUNDED', providerStatus: 'REFUNDED',
    });

    expect(result).toHaveLength(1);
    expect(prisma.asaasIntegrationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({
          status: 'FAILED', type: 'PAYMENT_REFUND_COMMAND',
          payload: { path: ['commandStatus'], equals: 'NEEDS_RECONCILIATION' },
        })]),
      }),
    }));
    expect(prisma.asaasIntegrationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ payload: { path: ['commandStatus'], equals: 'NEEDS_RECONCILIATION' } }),
      data: expect.objectContaining({ status: 'DONE', payload: expect.objectContaining({ commandStatus: 'CONFIRMED_BY_WEBHOOK' }) }),
    }));
  });

  it('abre issue de reconciliação para comando stale sem confirmação', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([
      {
        id: 'job-stale',
        contaId: 'conta-1',
        payload: {
          commandStatus: 'SENT_TO_ASAAS',
          commandType: 'PAYMENT_REFUND_COMMAND',
          entityType: 'CHARGE',
          entityId: 'chg-1',
          asaasPaymentId: 'pay-1',
          expectedEvents: ['PAYMENT_REFUNDED'],
          correlationId: 'corr-1',
          requestedAt: '2026-06-07T00:00:00.000Z',
        },
      },
    ] as never);
    vi.mocked(prisma.asaasIntegrationJob.update).mockResolvedValueOnce({ id: 'job-stale' } as never);

    const result = await markStalePaymentCommandsForReconciliation({
      contaId: 'conta-1',
      olderThanMinutes: 10,
    });

    expect(result).toEqual({ processed: 1, marked: 1 });
    expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      entityType: 'CHARGE',
      entityId: 'chg-1',
      asaasId: 'pay-1',
      issueType: 'PAYMENT_NEEDS_REVIEW',
      severity: 'HIGH',
    }));
  });

  it('espera PAYMENT_RECEIVED para comando de recebimento em dinheiro', () => {
    expect(expectedEventsForPaymentCommand('PAYMENT_MARK_CASH_COMMAND')).toEqual([
      'PAYMENT_RECEIVED',
      'PAYMENT_CONFIRMED',
    ]);
  });
});
