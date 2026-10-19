import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    storeSaleReturn: { findFirst: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    sale: { findFirst: vi.fn(), update: vi.fn() },
    saleItem: { updateMany: vi.fn() },
    inventoryBalance: { findFirst: vi.fn(), updateMany: vi.fn() },
    inventoryMovement: { create: vi.fn() },
  };
  return { tx, prismaMock: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } };
});

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../..//foundation/audit-log.service', () => ({ auditLogService: { record: vi.fn() } }));

import { registerSaleReturn, StoreInventoryError } from '../store-inventory';

describe('registerSaleReturn concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.storeSaleReturn.findFirst.mockResolvedValue(null);
    tx.storeSaleReturn.create.mockResolvedValue({ id: 'return-a' });
    tx.sale.findFirst.mockResolvedValue({
      id: 'sale-a', status: 'CONCLUIDA', inventoryStatus: 'FULFILLED', finalizationType: 'RECEBIMENTO_PRESENCIAL',
      charge: null, standaloneInstallmentPlan: null,
      items: [{
        id: 'item-a', productId: 'product-a', variantId: null, productName: 'Kit', quantity: 1, returnedQuantity: 0,
        unitCostAtSale: new Prisma.Decimal(2), subtotal: new Prisma.Decimal(20), unitPrice: new Prisma.Decimal(20),
        netSubtotalAtSale: new Prisma.Decimal(20), discountShareAtSale: new Prisma.Decimal(0),
      }],
    });
    tx.saleItem.updateMany.mockResolvedValue({ count: 0 });
  });

  it('rejects a concurrent over-return when the observed returnedQuantity CAS loses', async () => {
    await expect(registerSaleReturn({
      contaId: 'tenant-a', saleId: 'sale-a', actorUserId: 'user-a', requestId: 'return-request-a', requestFingerprint: 'fingerprint',
      items: [{ saleItemId: 'item-a', quantity: 1 }],
    })).rejects.toMatchObject({ code: 'DEVOLUCAO_CONCORRENTE', status: 409 });

    expect(tx.saleItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-a', saleId: 'sale-a', returnedQuantity: 0, quantity: { gte: 1 } },
    }));
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('recovers the committed winner for a concurrent duplicate tenant/request key', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prismaMock.$transaction
      .mockRejectedValueOnce(uniqueError)
      .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => {
        tx.storeSaleReturn.findFirst.mockResolvedValueOnce({
          id: 'return-winner', saleId: 'sale-a', requestFingerprint: 'fingerprint',
          refundRequestedAmount: new Prisma.Decimal(20),
        });
        tx.sale.findFirst.mockResolvedValueOnce({ inventoryStatus: 'RETURNED_PARTIAL' });
        return callback(tx);
      });

    await expect(registerSaleReturn({
      contaId: 'tenant-a', saleId: 'sale-a', actorUserId: 'user-a', requestId: 'return-request-a', requestFingerprint: 'fingerprint',
      items: [{ saleItemId: 'item-a', quantity: 1 }],
    })).resolves.toEqual({ inventoryStatus: 'RETURNED_PARTIAL', returnId: 'return-winner', refundAmount: 20 });
    expect(tx.storeSaleReturn.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate idempotency key when the winning payload differs', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prismaMock.$transaction
      .mockRejectedValueOnce(uniqueError)
      .mockImplementationOnce(async (callback: (client: typeof tx) => unknown) => {
        tx.storeSaleReturn.findFirst.mockResolvedValueOnce({
          id: 'return-winner', saleId: 'sale-a', requestFingerprint: 'different-payload',
          refundRequestedAmount: new Prisma.Decimal(20),
        });
        return callback(tx);
      });

    await expect(registerSaleReturn({
      contaId: 'tenant-a', saleId: 'sale-a', actorUserId: 'user-a', requestId: 'return-request-a', requestFingerprint: 'fingerprint',
      items: [{ saleItemId: 'item-a', quantity: 1 }],
    })).rejects.toMatchObject({ code: 'DEVOLUCAO_IDEMPOTENCY_CONFLICT', status: 409 });
  });
});
