import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@alusa/database';
import { registerSaleReturn } from '../store-inventory';
import { requestStoreSaleRefund } from '../store-sale-refund';

vi.mock('../payment-command-preflight', () => ({
  readPaymentFullPreflight: vi.fn(async () => ({ refunds: [] })),
}));

describe('store sale return idempotency (PostgreSQL)', () => {
  const createdContaIds: string[] = [];

  afterEach(async () => {
    for (const contaId of createdContaIds.splice(0)) {
      await prisma.inventoryMovement.deleteMany({ where: { contaId } });
      await prisma.storeSaleRefundAttempt.deleteMany({ where: { contaId } });
      await prisma.storeSaleReturn.deleteMany({ where: { contaId } });
      await prisma.inventoryBalance.deleteMany({ where: { contaId } });
      await prisma.sale.deleteMany({ where: { contaId } });
      await prisma.charge.deleteMany({ where: { contaId } });
      await prisma.product.deleteMany({ where: { contaId } });
      await prisma.conta.deleteMany({ where: { id: contaId } });
    }
  });

  it('returns the committed winner to concurrent identical requests with one stock movement', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Return race ${suffix}` } });
    createdContaIds.push(conta.id);
    const actor = await prisma.usuario.create({
      data: {
        contaId: conta.id,
        nome: `Return race actor ${suffix}`,
        email: `return-race-${suffix}@example.test`,
        senhaHash: 'integration-test-only',
      },
    });
    const product = await prisma.product.create({
      data: { contaId: conta.id, name: `Product ${suffix}`, price: new Prisma.Decimal(20), stock: 0 },
    });
    const sale = await prisma.sale.create({
      data: {
        contaId: conta.id,
        saleNumber: Math.floor(Math.random() * 1_000_000_000),
        status: 'CONCLUIDA',
        customerType: 'AVULSO',
        subtotal: new Prisma.Decimal(20),
        total: new Prisma.Decimal(20),
        finalizationType: 'RECEBIMENTO_PRESENCIAL',
        inventoryStatus: 'FULFILLED',
        items: {
          create: {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: new Prisma.Decimal(20),
            subtotal: new Prisma.Decimal(20),
            netSubtotalAtSale: new Prisma.Decimal(20),
          },
        },
      },
      include: { items: { select: { id: true } } },
    });
    await prisma.inventoryBalance.create({
      data: {
        contaId: conta.id,
        inventoryItemKey: `product:${product.id}`,
        productId: product.id,
        onHand: 0,
      },
    });

    const command = {
      contaId: conta.id,
      saleId: sale.id,
      actorUserId: actor.id,
      requestId: `return-${suffix}`,
      requestFingerprint: `fingerprint-${suffix}`,
      items: [{ saleItemId: sale.items[0]!.id, quantity: 1 }],
    };
    const results = await Promise.all([
      registerSaleReturn(command),
      registerSaleReturn(command),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(await prisma.storeSaleReturn.count({ where: { contaId: conta.id, requestId: command.requestId } })).toBe(1);
    expect(await prisma.inventoryMovement.count({
      where: { contaId: conta.id, originType: 'SALE', originId: sale.id, movementType: 'RETURN_IN' },
    })).toBe(1);
    const [item, balance] = await Promise.all([
      prisma.saleItem.findFirst({ where: { saleId: sale.id }, select: { returnedQuantity: true } }),
      prisma.inventoryBalance.findFirst({ where: { contaId: conta.id, productId: product.id }, select: { onHand: true } }),
    ]);
    expect(item?.returnedQuantity).toBe(1);
    expect(balance?.onHand).toBe(1);
  }, 30_000);

  it('rolls back the DENIED claim when retry-attempt insertion fails', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Refund rollback ${suffix}` } });
    createdContaIds.push(conta.id);
    const charge = await prisma.charge.create({
      data: {
        contaId: conta.id,
        externalReference: `store-refund-rollback-${suffix}`,
        asaasPaymentId: `payment-refund-rollback-${suffix}`,
        status: 'PAID',
        value: new Prisma.Decimal(50),
        billingType: 'PIX',
      },
    });
    const sale = await prisma.sale.create({
      data: {
        contaId: conta.id,
        saleNumber: Math.floor(Math.random() * 1_000_000_000),
        status: 'CONCLUIDA',
        customerType: 'AVULSO',
        subtotal: new Prisma.Decimal(50),
        total: new Prisma.Decimal(50),
        finalizationType: 'COBRANCA',
        chargeId: charge.id,
      },
    });
    const saleReturn = await prisma.storeSaleReturn.create({
      data: {
        contaId: conta.id,
        saleId: sale.id,
        requestId: `refund-rollback-${suffix}`,
        requestFingerprint: `fingerprint-${suffix}`,
        refundStatus: 'DENIED',
        refundRequestedAmount: new Prisma.Decimal(30),
      },
    });
    await prisma.storeSaleRefundAttempt.create({
      data: {
        contaId: conta.id,
        returnId: saleReturn.id,
        chargeId: charge.id,
        idempotencyKey: `refund-denied-${suffix}`,
        correlationId: `correlation-denied-${suffix}`,
        requestedAmount: new Prisma.Decimal(30),
        status: 'DENIED',
      },
    });

    let injectFailure = true;
    prisma.$use(async (params, next) => {
      if (injectFailure && params.model === 'StoreSaleRefundAttempt' && params.action === 'create') {
        injectFailure = false;
        throw new Error('simulated attempt insert failure');
      }
      return next(params);
    });

    await expect(requestStoreSaleRefund({
      contaId: conta.id,
      saleId: sale.id,
      returnId: saleReturn.id,
      actorId: 'integration-test-actor',
      role: 'FINANCEIRO',
      mode: 'RETRY_DENIED',
      dispatch: vi.fn(),
    })).rejects.toThrow('simulated attempt insert failure');

    expect(await prisma.storeSaleReturn.findFirst({
      where: { id: saleReturn.id, contaId: conta.id },
      select: { refundStatus: true },
    })).toEqual({ refundStatus: 'DENIED' });
    expect(await prisma.storeSaleRefundAttempt.count({ where: { contaId: conta.id, returnId: saleReturn.id } })).toBe(1);
  }, 30_000);
});
