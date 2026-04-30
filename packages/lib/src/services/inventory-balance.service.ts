import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';

export type InventoryBalanceRow = {
  productId: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  incoming: number;
  averageCost: Prisma.Decimal;
};

export function buildInventoryItemKey(productId: string, variantId?: string | null): string {
  return variantId ? `variant:${variantId}` : `product:${productId}`;
}

export function calculateAvailable(
  balance: Pick<InventoryBalanceRow, 'onHand' | 'reserved'>,
): number {
  return balance.onHand - balance.reserved;
}

export function calculateProjected(
  balance: Pick<InventoryBalanceRow, 'onHand' | 'reserved' | 'incoming'>,
): number {
  return calculateAvailable(balance) + balance.incoming;
}

export async function ensureProductInventoryBalance(input: {
  contaId: string;
  productId: string;
  initialOnHand?: number;
  averageCost?: number;
}) {
  const inventoryItemKey = buildInventoryItemKey(input.productId);
  const averageCost = input.averageCost ?? 0;

  if (!Number.isFinite(averageCost) || averageCost < 0) {
    throw new Error('Informe um custo médio válido.');
  }

  return prisma.inventoryBalance.upsert({
    where: {
      contaId_inventoryItemKey: {
        contaId: input.contaId,
        inventoryItemKey,
      },
    },
    update: {},
    create: {
      contaId: input.contaId,
      inventoryItemKey,
      productId: input.productId,
      onHand: Math.max(input.initialOnHand ?? 0, 0),
      reserved: 0,
      incoming: 0,
      averageCost: Number(averageCost.toFixed(4)),
    },
  });
}

export async function ensureVariantInventoryBalance(input: {
  contaId: string;
  productId: string;
  variantId: string;
  initialOnHand?: number;
}) {
  const inventoryItemKey = buildInventoryItemKey(input.productId, input.variantId);

  return prisma.inventoryBalance.upsert({
    where: {
      contaId_inventoryItemKey: {
        contaId: input.contaId,
        inventoryItemKey,
      },
    },
    update: {},
    create: {
      contaId: input.contaId,
      inventoryItemKey,
      productId: input.productId,
      variantId: input.variantId,
      onHand: Math.max(input.initialOnHand ?? 0, 0),
      reserved: 0,
      incoming: 0,
      averageCost: 0,
    },
  });
}

export async function setInventoryAverageCost(input: {
  contaId: string;
  productId: string;
  variantId?: string | null;
  averageCost: number;
}) {
  if (!Number.isFinite(input.averageCost) || input.averageCost < 0) {
    throw new Error('Informe um custo médio válido.');
  }

  const averageCost = Number(input.averageCost.toFixed(4));
  const inventoryItemKey = buildInventoryItemKey(input.productId, input.variantId);

  return prisma.inventoryBalance.upsert({
    where: {
      contaId_inventoryItemKey: {
        contaId: input.contaId,
        inventoryItemKey,
      },
    },
    update: {
      averageCost,
    },
    create: {
      contaId: input.contaId,
      inventoryItemKey,
      productId: input.productId,
      variantId: input.variantId ?? null,
      onHand: 0,
      reserved: 0,
      incoming: 0,
      averageCost,
    },
  });
}

export async function listInventoryBalanceRows(contaId: string, productIds: string[]) {
  if (productIds.length === 0) return [];

  return prisma.inventoryBalance.findMany({
    where: {
      contaId,
      productId: {
        in: productIds,
      },
    },
    select: {
      productId: true,
      variantId: true,
      onHand: true,
      reserved: true,
      incoming: true,
      averageCost: true,
    },
  });
}
