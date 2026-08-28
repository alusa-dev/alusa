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
  return revalueInventoryAverageCost({
    ...input,
    reason: 'Atualização manual do custo médio.',
  });
}

type InventoryTransaction = Prisma.TransactionClient;

/**
 * Altera o custo médio sem mexer na quantidade e deixa uma trilha auditável.
 * Isso é diferente de uma entrada: não deve criar estoque, apenas reavaliar
 * o valor contábil do saldo existente.
 */
export async function revalueInventoryAverageCost(input: {
  contaId: string;
  productId: string;
  variantId?: string | null;
  averageCost: number;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  if (!Number.isFinite(input.averageCost) || input.averageCost < 0) {
    throw new Error('Informe um custo médio válido.');
  }

  const averageCost = Number(input.averageCost.toFixed(4));
  const inventoryItemKey = buildInventoryItemKey(input.productId, input.variantId);

  return prisma.$transaction(async (tx) =>
    revalueInventoryAverageCostInTransaction(tx, input, averageCost, inventoryItemKey),
  );
}

export async function revalueInventoryAverageCostInTransaction(
  tx: InventoryTransaction,
  input: {
    contaId: string;
    productId: string;
    variantId?: string | null;
    averageCost: number;
    actorUserId?: string | null;
    reason?: string | null;
  },
  normalizedAverageCost = Number(input.averageCost.toFixed(4)),
  inventoryItemKey = buildInventoryItemKey(input.productId, input.variantId),
) {
  if (!Number.isFinite(input.averageCost) || input.averageCost < 0) {
    throw new Error('Informe um custo médio válido.');
  }

  const product = await tx.product.findFirst({
    where: { id: input.productId, contaId: input.contaId },
    select: { id: true },
  });
  if (!product) throw new Error('Produto não encontrado');

  if (input.variantId) {
    const variant = await tx.productVariant.findFirst({
      where: { id: input.variantId, productId: input.productId },
      select: { id: true },
    });
    if (!variant) throw new Error('Variante não encontrada');
  }

  const balance = await tx.inventoryBalance.upsert({
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
      variantId: input.variantId ?? null,
      onHand: 0,
      reserved: 0,
      incoming: 0,
      averageCost: 0,
    },
  });

  const previousAverageCost = Number(balance.averageCost);
  if (previousAverageCost === normalizedAverageCost) return balance;

  const updated = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { averageCost: normalizedAverageCost },
  });

  await tx.auditLog.create({
    data: {
      contaId: input.contaId,
      actorType: input.actorUserId ? 'USER' : 'SYSTEM',
      actorId: input.actorUserId ?? undefined,
      action: 'loja.inventory.cost_revalued',
      entityType: 'InventoryBalance',
      entityId: balance.id,
      metadata: {
        productId: input.productId,
        variantId: input.variantId ?? null,
        inventoryItemKey,
        onHand: balance.onHand,
        previousAverageCost,
        averageCost: normalizedAverageCost,
        inventoryValueBefore: Number((balance.onHand * previousAverageCost).toFixed(4)),
        inventoryValueAfter: Number((balance.onHand * normalizedAverageCost).toFixed(4)),
        reason: input.reason?.trim() || 'Reavaliação manual do custo médio.',
      },
    },
  });

  return updated;
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
