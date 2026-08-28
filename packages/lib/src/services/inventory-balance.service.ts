import { prisma } from '../prisma';
import { Prisma } from '@prisma/client';

export type InventoryBalanceRow = {
  productId: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  incoming: number;
  averageCost: Prisma.Decimal;
};

export type InventoryCostMovement = {
  onHandDelta: number;
  unitCost: number | Prisma.Decimal | null;
};

export type InventoryCostBasis = {
  onHand: number;
  inventoryValue: number;
  averageCost: number;
};

/**
 * Reconstructs the acquisition cost of the current physical stock from the
 * inventory ledger. A zero cost is an explicit acquisition cost, not a
 * missing value, so it participates in the weighted average as zero.
 */
export function calculateInventoryCostBasis(
  movements: readonly InventoryCostMovement[],
): InventoryCostBasis {
  let onHand = 0;
  let inventoryValue = 0;

  for (const movement of movements) {
    const delta = Number(movement.onHandDelta);
    if (!Number.isFinite(delta) || delta === 0) continue;

    if (delta > 0) {
      const unitCost = Math.max(Number(movement.unitCost ?? 0), 0);
      onHand += delta;
      inventoryValue += delta * unitCost;
      continue;
    }

    const quantityRemoved = Math.min(Math.abs(delta), onHand);
    const currentAverageCost = onHand > 0 ? inventoryValue / onHand : 0;
    onHand -= quantityRemoved;
    inventoryValue = Math.max(0, inventoryValue - quantityRemoved * currentAverageCost);
  }

  const normalizedOnHand = Math.max(0, Math.trunc(onHand));
  const normalizedValue = Number(Math.max(0, inventoryValue).toFixed(4));

  return {
    onHand: normalizedOnHand,
    inventoryValue: normalizedValue,
    averageCost:
      normalizedOnHand > 0
        ? Number((normalizedValue / normalizedOnHand).toFixed(4))
        : 0,
  };
}

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

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      contaId,
      productId: {
        in: productIds,
      },
    },
    select: {
      inventoryItemKey: true,
      productId: true,
      variantId: true,
      onHand: true,
      reserved: true,
      incoming: true,
      averageCost: true,
    },
  });

  const inventoryItemKeys = balances.map((balance) => balance.inventoryItemKey);
  if (inventoryItemKeys.length === 0) return balances;

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      contaId,
      inventoryItemKey: { in: inventoryItemKeys },
      onHandDelta: { not: 0 },
    },
    select: {
      inventoryItemKey: true,
      onHandDelta: true,
      unitCost: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const movementsByItem = new Map<string, InventoryCostMovement[]>();
  for (const movement of movements) {
    const itemMovements = movementsByItem.get(movement.inventoryItemKey) ?? [];
    itemMovements.push(movement);
    movementsByItem.set(movement.inventoryItemKey, itemMovements);
  }

  return balances.map((balance) => {
    const itemMovements = movementsByItem.get(balance.inventoryItemKey);
    if (!itemMovements?.length) return balance;

    const costBasis = calculateInventoryCostBasis(itemMovements);
    if (costBasis.onHand !== balance.onHand) return balance;

    return {
      ...balance,
      averageCost: new Prisma.Decimal(costBasis.averageCost),
    };
  });
}
