import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

import { listInventoryBalances, reconcilePaidReservedStoreSales } from '../store-inventory';

const prismaMock = vi.hoisted(() => ({
  inventoryBalance: {
    findMany: vi.fn(),
  },
  inventoryMovement: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  sale: {
    findMany: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

type BalanceFixtureInput = {
  id: string;
  contaId?: string;
  productId: string;
  productName: string;
  productSku?: string | null;
  hasVariants: boolean;
  variantId?: string | null;
  variantTitle?: string | null;
  variantSku?: string | null;
  variantPrice?: string | null;
  variantAttributes?: Array<{ name: string; value: string }>;
  onHand: number;
  reserved?: number;
  incoming?: number;
  averageCost?: string;
  productActive?: boolean;
  variantActive?: boolean;
  lowStockThreshold?: number;
};

function balanceFixture(input: BalanceFixtureInput) {
  return {
    id: input.id,
    contaId: input.contaId ?? 'conta-1',
    inventoryItemKey: input.variantId
      ? `${input.productId}:${input.variantId}`
      : input.productId,
    productId: input.productId,
    variantId: input.variantId ?? null,
    onHand: input.onHand,
    reserved: input.reserved ?? 0,
    incoming: input.incoming ?? 0,
    averageCost: new Prisma.Decimal(input.averageCost ?? '0'),
    product: {
      id: input.productId,
      name: input.productName,
      sku: input.productSku ?? null,
      price: new Prisma.Decimal('100.00'),
      lowStockThreshold: input.lowStockThreshold ?? 5,
      hasVariants: input.hasVariants,
      isActive: input.productActive ?? true,
      archivedAt: null,
      categoryId: 'cat-1',
      category: {
        id: 'cat-1',
        name: 'Acessórios',
      },
    },
    variant: input.variantId
      ? {
          id: input.variantId,
          title: input.variantTitle ?? '',
          sku: input.variantSku ?? null,
          price: input.variantPrice != null ? new Prisma.Decimal(input.variantPrice) : null,
          lowStockThreshold: input.lowStockThreshold ?? 5,
          isActive: input.variantActive ?? true,
          options: (input.variantAttributes ?? []).map((attribute) => ({
            optionValue: {
              value: attribute.value,
              option: { name: attribute.name },
            },
          })),
        }
      : null,
  };
}

describe('listInventoryBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista produto sem variantes como unidade vendável', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-product',
        productId: 'product-simple',
        productName: 'Faixa de cabelo',
        hasVariants: false,
        onHand: 4,
        averageCost: '8.50',
      }),
    ]);

    const result = await listInventoryBalances({ contaId: 'conta-1' });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      productId: 'product-simple',
      productName: 'Faixa de cabelo',
      variantId: null,
      onHand: 4,
      inventoryValue: 34,
    });
  });

  it('identifica vendas pagas com estoque reservado em modo dry-run', async () => {
    prismaMock.sale.findMany.mockResolvedValueOnce([
      {
        id: 'sale-1',
        chargeId: 'charge-1',
        charge: { id: 'charge-1', status: 'PAID' },
        standaloneInstallmentPlan: null,
      },
    ]);

    const result = await reconcilePaidReservedStoreSales({ contaId: 'conta-1', dryRun: true });

    expect(result).toEqual({ checked: 1, fulfilled: 0, errors: [] });
    expect(prismaMock.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-1' }) }),
    );
  });

  it('não lista produto pai com variantes, mas lista as variantes reais', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-parent',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        onHand: 0,
      }),
      balanceFixture({
        id: 'balance-29',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-29',
        variantTitle: '29',
        onHand: 7,
        averageCost: '10',
      }),
      balanceFixture({
        id: 'balance-30',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-30',
        variantTitle: '30',
        onHand: 5,
        averageCost: '10',
      }),
      balanceFixture({
        id: 'balance-31',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-31',
        variantTitle: '31',
        onHand: 9,
        averageCost: '10',
      }),
    ]);

    const result = await listInventoryBalances({ contaId: 'conta-1' });

    expect(result.map((item) => item.variantTitle)).toEqual(['29', '30', '31']);
    expect(result.some((item) => item.variantId === null)).toBe(false);
  });

  it('does not use the product price for a variant without an individual price', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-rosa-30',
        productId: 'product-sapatilha',
        productName: 'Sapatilha',
        hasVariants: true,
        variantId: 'variant-rosa-30',
        variantTitle: 'Número 30',
        variantAttributes: [{ name: 'Rosa', value: 'Número 30' }],
        onHand: 7,
      }),
    ]);

    const [result] = await listInventoryBalances({ contaId: 'conta-1' });

    expect(result).toMatchObject({
      variantTitle: 'Rosa · Número 30',
      variantAttributes: [{ name: 'Rosa', value: 'Número 30' }],
      price: null,
    });
  });

  it('uses the individual variant price when it is configured', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-rosa-31',
        productId: 'product-sapatilha',
        productName: 'Sapatilha',
        hasVariants: true,
        variantId: 'variant-rosa-31',
        variantPrice: '62.00',
        onHand: 3,
      }),
    ]);

    const [result] = await listInventoryBalances({ contaId: 'conta-1' });

    expect(result?.price).toBe(62);
  });

  it('calcula totais apenas com itens exibíveis quando produto tem variantes', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-parent',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        onHand: 100,
        reserved: 20,
        incoming: 30,
        averageCost: '99',
      }),
      balanceFixture({
        id: 'balance-29',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-29',
        variantTitle: '29',
        onHand: 7,
        reserved: 1,
        incoming: 2,
        averageCost: '3',
      }),
      balanceFixture({
        id: 'balance-30',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-30',
        variantTitle: '30',
        onHand: 5,
        reserved: 2,
        incoming: 4,
        averageCost: '3',
      }),
    ]);

    const result = await listInventoryBalances({ contaId: 'conta-1' });
    const totals = result.reduce(
      (acc, item) => ({
        onHand: acc.onHand + item.onHand,
        reserved: acc.reserved + item.reserved,
        available: acc.available + item.available,
        incoming: acc.incoming + item.incoming,
        value: acc.value + item.inventoryValue,
      }),
      { onHand: 0, reserved: 0, available: 0, incoming: 0, value: 0 },
    );

    expect(totals).toEqual({
      onHand: 12,
      reserved: 3,
      available: 9,
      incoming: 6,
      value: 36,
    });
  });

  it('busca por nome do produto pai sem reintroduzir o item pai', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([
      balanceFixture({
        id: 'balance-parent',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        onHand: 0,
      }),
      balanceFixture({
        id: 'balance-29',
        productId: 'product-sapatilha',
        productName: 'Sapatilha - Branco',
        hasVariants: true,
        variantId: 'variant-29',
        variantTitle: '29',
        onHand: 7,
      }),
    ]);

    const result = await listInventoryBalances({
      contaId: 'conta-1',
      search: 'Sapatilha Branco',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.variantTitle).toBe('29');
    expect(prismaMock.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          OR: expect.arrayContaining([
            {
              product: {
                name: {
                  contains: 'Sapatilha Branco',
                  mode: 'insensitive',
                },
              },
            },
          ]),
        }),
      }),
    );
  });

  it('preserva isolamento multi-tenant por contaId na consulta', async () => {
    prismaMock.inventoryBalance.findMany.mockResolvedValueOnce([]);

    await listInventoryBalances({ contaId: 'conta-2' });

    expect(prismaMock.inventoryBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-2',
        }),
      }),
    );
  });
});
