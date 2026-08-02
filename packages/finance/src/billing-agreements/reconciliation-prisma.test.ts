import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { createPrismaBillingIntegrityRepository } from './reconciliation-prisma';
import type { BillingIntegrityRepairAction } from './reconciliation';

function prismaMock() {
  return {
    matricula: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    billingAgreement: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ id: 'agreement-1', desiredValue: 150, status: 'ACTIVE' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    billingAdjustment: {
      findUnique: vi.fn(async () => null as { id: string } | null),
      create: vi.fn(async () => ({ id: 'adjustment-1' })),
    },
    charge: {
      findFirst: vi.fn(async () => ({ id: 'charge-1' })),
    },
  };
}

function action(overrides?: Partial<BillingIntegrityRepairAction>): BillingIntegrityRepairAction {
  return {
    id: 'CREATE_COMPLEMENT_ADJUSTMENT:issue-1:15000',
    kind: 'CREATE_COMPLEMENT_ADJUSTMENT',
    issueCode: 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
    agreementId: 'agreement-1',
    enrollmentId: null,
    amountCents: 15_000,
    effectiveDate: '2026-08-05',
    chargeId: 'charge-1',
    automatic: true,
    reason: 'test',
    ...overrides,
  };
}

describe('createPrismaBillingIntegrityRepository', () => {
  it('carrega todas as entidades sempre filtrando pelo tenant', async () => {
    const mock = prismaMock();
    const repository = createPrismaBillingIntegrityRepository(mock as unknown as PrismaClient);

    const result = await repository.loadSnapshot({ contaId: 'conta-1' });

    expect(result.contaId).toBe('conta-1');
    expect(mock.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1' }),
    }));
    expect(mock.billingAgreement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1' },
    }));
  });

  it('cria complemento com chave idempotente tenant-scoped e não duplica no retry', async () => {
    const mock = prismaMock();
    const repository = createPrismaBillingIntegrityRepository(mock as unknown as PrismaClient);
    const repair = action();

    await expect(repository.applyRepair({ contaId: 'conta-1', action: repair })).resolves.toBe('APPLIED');
    expect(mock.billingAdjustment.findUnique).toHaveBeenCalledWith({
      where: {
        uq_billing_adjustment_conta_idempotency: {
          contaId: 'conta-1',
          idempotencyKey: expect.stringContaining(repair.id),
        },
      },
      select: { id: true },
    });
    expect(mock.billingAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contaId: 'conta-1',
        agreementId: 'agreement-1',
        type: 'COMPLEMENT',
        status: 'PENDING',
        amount: 150,
        chargeId: 'charge-1',
      }),
    });

    mock.billingAdjustment.findUnique.mockResolvedValueOnce({ id: 'adjustment-1' });
    await expect(repository.applyRepair({ contaId: 'conta-1', action: repair })).resolves.toBe('ALREADY_APPLIED');
    expect(mock.billingAdjustment.create).toHaveBeenCalledTimes(1);
  });

  it('rebaixa somente matrícula provisionada do tenant solicitado', async () => {
    const mock = prismaMock();
    const repository = createPrismaBillingIntegrityRepository(mock as unknown as PrismaClient);

    await repository.applyRepair({
      contaId: 'conta-1',
      action: action({
        id: 'MARK_ENROLLMENT_PARTIAL:issue-1',
        kind: 'MARK_ENROLLMENT_PARTIAL',
        agreementId: null,
        enrollmentId: 'enrollment-1',
        amountCents: null,
        effectiveDate: null,
      }),
    });

    expect(mock.matricula.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'enrollment-1',
        contaId: 'conta-1',
        billingProvisionStatus: 'PROVISIONADO',
      },
      data: {
        billingProvisionStatus: 'PARCIAL',
        billingProvisionError: 'PAID_CURRENT_CHARGE_WITHOUT_COMPLEMENT',
      },
    });
  });
});
