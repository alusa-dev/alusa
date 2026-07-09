import { describe, expect, it, vi } from 'vitest';
import { MatriculaBillingOutboxStatus } from '@prisma/client';

import { enqueueEnrollmentBillingOutbox } from './enrollment-billing-outbox.service';

describe('enqueueEnrollmentBillingOutbox', () => {
  it('reaproveita evento aberto para a mesma matrícula e conta', async () => {
    const existing = {
      id: 'outbox-1',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      status: MatriculaBillingOutboxStatus.PENDING,
      dedupeKey: 'enrollment-billing:mat-1',
    };
    const prisma = {
      matriculaBillingOutbox: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    };

    const result = await enqueueEnrollmentBillingOutbox(
      { contaId: 'conta-1', matriculaId: 'mat-1', actorUserId: 'user-1' },
      { prisma: prisma as never },
    );

    expect(result).toBe(existing);
    expect(prisma.matriculaBillingOutbox.findFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        dedupeKey: 'enrollment-billing:mat-1',
        status: {
          in: [
            MatriculaBillingOutboxStatus.PENDING,
            MatriculaBillingOutboxStatus.PROCESSING,
            MatriculaBillingOutboxStatus.FAILED,
            MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
    });
    expect(prisma.matriculaBillingOutbox.create).not.toHaveBeenCalled();
  });

  it('trata corrida de criação pela chave de dedupe', async () => {
    const raced = {
      id: 'outbox-2',
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      status: MatriculaBillingOutboxStatus.PENDING,
      dedupeKey: 'enrollment-billing:mat-1',
    };
    const prisma = {
      matriculaBillingOutbox: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(raced),
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };

    const result = await enqueueEnrollmentBillingOutbox(
      { contaId: 'conta-1', matriculaId: 'mat-1', actorUserId: 'user-1' },
      { prisma: prisma as never },
    );

    expect(result).toBe(raced);
    expect(prisma.matriculaBillingOutbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1',
          matriculaId: 'mat-1',
          eventType: 'PROVISION_ENROLLMENT_BILLING',
          dedupeKey: 'enrollment-billing:mat-1',
        }),
      }),
    );
  });
});
