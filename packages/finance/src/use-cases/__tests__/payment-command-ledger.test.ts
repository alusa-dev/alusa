import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasIntegrationJob: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

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
  markPaymentCommandSent,
  markStalePaymentCommandsForReconciliation,
  registerPaymentCommand,
} from '../payment-command-ledger';

describe('payment-command-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registra comando de pagamento com chave idempotente por conta/tipo/correlationId', async () => {
    vi.mocked(prisma.asaasIntegrationJob.upsert).mockResolvedValueOnce({ id: 'job-1' } as never);

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

  it('confirma comandos pendentes quando webhook/sync traz evento esperado', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([
      {
        id: 'job-1',
        contaId: 'conta-1',
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
    vi.mocked(prisma.asaasIntegrationJob.update).mockResolvedValueOnce({ id: 'job-1' } as never);

    const result = await confirmPaymentCommandsByProviderEvent({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
      eventName: 'PAYMENT_DELETED',
      providerStatus: 'DELETED',
    });

    expect(result).toHaveLength(1);
    expect(prisma.asaasIntegrationJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1' },
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
});
