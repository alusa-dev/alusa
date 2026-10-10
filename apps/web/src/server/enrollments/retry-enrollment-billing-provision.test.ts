import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';

const mocks = vi.hoisted(() => ({
  matriculaFindMany: vi.fn(),
  outboxFindFirst: vi.fn(),
  processEvent: vi.fn(),
  enqueueBilling: vi.fn(),
  enqueueMerge: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    matricula: { findMany: mocks.matriculaFindMany },
    matriculaBillingOutbox: { findFirst: mocks.outboxFindFirst },
  },
}));

vi.mock('@/lib/observability/api-logger', () => ({
  logEnrollmentOperationalEvent: vi.fn(),
}));

vi.mock('@/src/server/enrollments/enrollment-billing-outbox.service', () => ({
  enqueueEnrollmentBillingOutbox: mocks.enqueueBilling,
  enqueueEnrollmentSubscriptionMergeOutbox: mocks.enqueueMerge,
  processEnrollmentBillingOutboxEvent: mocks.processEvent,
}));

import { retryEnrollmentBillingProvisionJob } from './retry-enrollment-billing-provision';

describe('retryEnrollmentBillingProvisionJob scheduled outbox eligibility', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    mocks.matriculaFindMany.mockResolvedValue([]);
    mocks.outboxFindFirst.mockResolvedValue(null);
    mocks.processEvent.mockResolvedValue({ status: 'PROCESSED' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('não seleciona nem consome lote com apenas assinatura agendada no futuro', async () => {
    const result = await retryEnrollmentBillingProvisionJob({ limit: 1 });

    expect(result.scanned).toBe(0);
    expect(mocks.matriculaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          OR: [
            {
              billingOutboxEvents: {
                some: {
                  status: {
                    in: [
                      MatriculaBillingOutboxStatus.PENDING,
                      MatriculaBillingOutboxStatus.PROCESSING,
                      MatriculaBillingOutboxStatus.FAILED,
                    ],
                  },
                  availableAt: { lte: now },
                },
              },
            },
            {
              billingOutboxEvents: {
                none: {
                  status: {
                    in: [
                      MatriculaBillingOutboxStatus.PENDING,
                      MatriculaBillingOutboxStatus.PROCESSING,
                      MatriculaBillingOutboxStatus.FAILED,
                    ],
                  },
                },
              },
            },
          ],
        }),
      }),
    );
    expect(mocks.outboxFindFirst).not.toHaveBeenCalled();
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it('mantém elegível taxa falha vencida mesmo com assinatura futura e só seleciona evento disponível', async () => {
    mocks.matriculaFindMany.mockResolvedValue([
      {
        id: 'mat-fee-retry',
        contaId: 'conta-1',
        billingMode: 'INDIVIDUAL',
        billingProvisionStatus: MatriculaBillingProvisionStatus.FALHO,
      },
    ]);
    mocks.outboxFindFirst.mockResolvedValue({ id: 'fee-event-due', terminalIntent: null });

    const result = await retryEnrollmentBillingProvisionJob({ limit: 1 });

    expect(result).toMatchObject({ scanned: 1, retried: 1, recovered: 1, errors: [] });
    expect(mocks.matriculaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              billingOutboxEvents: {
                some: {
                  status: {
                    in: [
                      MatriculaBillingOutboxStatus.PENDING,
                      MatriculaBillingOutboxStatus.PROCESSING,
                      MatriculaBillingOutboxStatus.FAILED,
                    ],
                  },
                  availableAt: { lte: now },
                },
              },
            },
          ]),
        }),
      }),
    );
    expect(mocks.outboxFindFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        matriculaId: 'mat-fee-retry',
        status: {
          in: [
            MatriculaBillingOutboxStatus.PENDING,
            MatriculaBillingOutboxStatus.PROCESSING,
            MatriculaBillingOutboxStatus.FAILED,
            MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          ],
        },
        availableAt: { lte: now },
      },
      select: { id: true, terminalIntent: true },
    });
    expect(mocks.processEvent).toHaveBeenCalledWith('fee-event-due');
  });
});
