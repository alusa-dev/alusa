import { prisma } from '@alusa/database';
import {
  InventoryMovementType,
  Prisma,
  RestockOrderStatus,
  SaleInventoryMode,
  SaleInventoryStatus,
  SaleStatus,
} from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';

const DEFAULT_MOVEMENTS_LIMIT = 100;

type Tx = Prisma.TransactionClient;

const INVENTORY_BALANCE_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      lowStockThreshold: true,
      hasVariants: true,
      isActive: true,
      archivedAt: true,
      categoryId: true,
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  variant: {
    select: {
      id: true,
      title: true,
      sku: true,
      price: true,
      lowStockThreshold: true,
      isActive: true,
    },
  },
} satisfies Prisma.InventoryBalanceInclude;

const INVENTORY_MOVEMENT_INCLUDE = {
  actor: {
    select: {
      id: true,
      nome: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
    },
  },
  variant: {
    select: {
      id: true,
      title: true,
    },
  },
} satisfies Prisma.InventoryMovementInclude;

const RESTOCK_ORDER_INCLUDE = {
  createdBy: {
    select: {
      id: true,
      nome: true,
    },
  },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
      variant: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  },
} satisfies Prisma.RestockOrderInclude;

type InventoryBalanceRecord = Prisma.InventoryBalanceGetPayload<{ include: typeof INVENTORY_BALANCE_INCLUDE }>;
type InventoryMovementRecord = Prisma.InventoryMovementGetPayload<{ include: typeof INVENTORY_MOVEMENT_INCLUDE }>;
type RestockOrderRecord = Prisma.RestockOrderGetPayload<{ include: typeof RESTOCK_ORDER_INCLUDE }>;

type SaleInventoryLineInput = {
  saleItemId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  quantity: number;
};

export type InventoryAlertState = 'OUT' | 'LOW' | 'OK';

export type InventoryBalanceDTO = {
  id: string;
  inventoryItemKey: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantTitle: string | null;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  hasVariants: boolean;
  isActive: boolean;
  lowStockThreshold: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
  averageCost: number;
  inventoryValue: number;
  price: number | null;
  alertState: InventoryAlertState;
};

export type InventoryMovementDTO = {
  id: string;
  inventoryItemKey: string;
  movementType: InventoryMovementType;
  productId: string;
  productName: string;
  variantId: string | null;
  variantTitle: string | null;
  onHandBefore: number;
  onHandDelta: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedDelta: number;
  reservedAfter: number;
  incomingBefore: number;
  incomingDelta: number;
  incomingAfter: number;
  unitCost: number | null;
  totalCost: number | null;
  originType: string;
  originId: string;
  originLineId: string;
  originActionKey: string;
  reason: string | null;
  actor: {
    id: string | null;
    name: string | null;
  };
  createdAt: string;
};

export type RestockOrderItemDTO = {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantTitle: string | null;
  quantityExpected: number;
  quantityReceived: number;
  quantityPending: number;
  estimatedUnitCost: number | null;
};

export type RestockOrderDTO = {
  id: string;
  status: RestockOrderStatus;
  supplierName: string | null;
  expectedAt: string | null;
  notes: string | null;
  canceledAt: string | null;
  canceledReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    name: string;
  };
  items: RestockOrderItemDTO[];
};

export type ListInventoryBalancesInput = {
  contaId: string;
  search?: string;
  productId?: string;
  variantId?: string;
  lowOnly?: boolean;
  includeInactive?: boolean;
};

export type ListInventoryMovementsInput = {
  contaId: string;
  productId?: string;
  variantId?: string;
  movementType?: InventoryMovementType;
  search?: string;
  fromDate?: string;
  toDate?: string;
  actorUserId?: string;
  originType?: string;
  limit?: number;
};

export type RegisterInventoryEntryInput = {
  contaId: string;
  actorUserId: string;
  requestId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost: number;
  supplierName?: string | null;
  reason?: string | null;
};

export type AdjustInventoryInput = {
  contaId: string;
  actorUserId: string;
  requestId: string;
  productId: string;
  variantId?: string | null;
  mode: 'SET' | 'DELTA';
  quantity: number;
  reasonCode: 'COUNT' | 'LOSS' | 'DAMAGE' | 'CORRECTION';
  note?: string | null;
};

export type CreateRestockOrderInput = {
  contaId: string;
  actorUserId: string;
  requestId: string;
  supplierName?: string | null;
  expectedAt?: string | null;
  notes?: string | null;
  items: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitCost: number;
  }>;
};

export type ReceiveRestockOrderInput = {
  contaId: string;
  actorUserId: string;
  restockOrderId: string;
  items: Array<{
    itemId: string;
    quantityReceived: number;
    unitCost?: number | null;
  }>;
};

export type CancelRestockOrderInput = {
  contaId: string;
  actorUserId: string;
  restockOrderId: string;
  reason?: string | null;
};

export type ListRestockOrdersInput = {
  contaId: string;
  status?: RestockOrderStatus | 'TODOS';
  search?: string;
};

export type FulfillReservedSaleInput = {
  contaId: string;
  saleId: string;
  actorUserId: string;
};

export type RegisterSaleReturnInput = {
  contaId: string;
  saleId: string;
  actorUserId: string;
  items: Array<{
    saleItemId: string;
    quantity: number;
  }>;
  reason?: string | null;
};

export class StoreInventoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'StoreInventoryError';
    this.code = code;
    this.status = status;
  }
}

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDateInput(value?: string | null): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new StoreInventoryError('DATA_INVALIDA', 'Data inválida.', 422);
  }
  return normalized;
}

function moneyToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

function moneyToDecimal(value: number, precision = 4): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(precision));
}

function buildInventoryItemKey(productId: string, variantId?: string | null): string {
  return variantId ? `variant:${variantId}` : `product:${productId}`;
}

function calculateAvailable(balance: { onHand: number; reserved: number }): number {
  return balance.onHand - balance.reserved;
}

function calculateProjected(balance: { onHand: number; reserved: number; incoming: number }): number {
  return calculateAvailable(balance) + balance.incoming;
}

function calculateAlertState(
  available: number,
  threshold: number,
): InventoryAlertState {
  if (available <= 0) return 'OUT';
  if (available <= Math.max(threshold, 0)) return 'LOW';
  return 'OK';
}

function computeAverageCost(
  currentOnHand: number,
  currentAverageCost: number,
  deltaQuantity: number,
  incomingUnitCost: number,
): number {
  const safeDelta = Math.max(deltaQuantity, 0);
  const safeUnitCost = Math.max(incomingUnitCost, 0);
  if (safeDelta <= 0) return currentAverageCost;

  const nextOnHand = currentOnHand + safeDelta;
  if (nextOnHand <= 0) return currentAverageCost;
  if (currentOnHand <= 0) return safeUnitCost;

  const currentValue = currentOnHand * currentAverageCost;
  const incomingValue = safeDelta * safeUnitCost;

  return Number(((currentValue + incomingValue) / nextOnHand).toFixed(4));
}

function buildMovementTotalCost(input: {
  movementType: InventoryMovementType;
  unitCost: Prisma.Decimal | null;
  onHandDelta: number;
  incomingDelta: number;
}): Prisma.Decimal | null {
  if (!input.unitCost) return null;
  const quantityBase = Math.abs(input.onHandDelta) > 0 ? Math.abs(input.onHandDelta) : Math.abs(input.incomingDelta);
  if (quantityBase <= 0) return null;
  return input.unitCost.mul(quantityBase);
}

function formatBalanceRecord(record: InventoryBalanceRecord): InventoryBalanceDTO {
  const onHand = record.onHand;
  const reserved = record.reserved;
  const incoming = record.incoming;
  const available = calculateAvailable(record);
  const projected = calculateProjected(record);
  const lowStockThreshold = record.variant?.lowStockThreshold ?? record.product.lowStockThreshold;
  const averageCost = moneyToNumber(record.averageCost);

  return {
    id: record.id,
    inventoryItemKey: record.inventoryItemKey,
    productId: record.productId,
    productName: record.product.name,
    variantId: record.variantId ?? null,
    variantTitle: record.variant?.title ?? null,
    sku: record.variant?.sku ?? record.product.sku ?? null,
    categoryId: record.product.categoryId ?? null,
    categoryName: record.product.category?.name ?? null,
    hasVariants: record.product.hasVariants,
    isActive: record.variant ? record.variant.isActive : record.product.isActive,
    lowStockThreshold,
    onHand,
    reserved,
    available,
    incoming,
    projected,
    averageCost,
    inventoryValue: Number((onHand * averageCost).toFixed(4)),
    price: record.variant?.price != null ? moneyToNumber(record.variant.price) : moneyToNumber(record.product.price),
    alertState: calculateAlertState(available, lowStockThreshold),
  };
}

function formatMovementRecord(record: InventoryMovementRecord): InventoryMovementDTO {
  return {
    id: record.id,
    inventoryItemKey: record.inventoryItemKey,
    movementType: record.movementType,
    productId: record.productId,
    productName: record.product.name,
    variantId: record.variantId ?? null,
    variantTitle: record.variant?.title ?? null,
    onHandBefore: record.onHandBefore,
    onHandDelta: record.onHandDelta,
    onHandAfter: record.onHandAfter,
    reservedBefore: record.reservedBefore,
    reservedDelta: record.reservedDelta,
    reservedAfter: record.reservedAfter,
    incomingBefore: record.incomingBefore,
    incomingDelta: record.incomingDelta,
    incomingAfter: record.incomingAfter,
    unitCost: record.unitCost != null ? moneyToNumber(record.unitCost) : null,
    totalCost: record.totalCost != null ? moneyToNumber(record.totalCost) : null,
    originType: record.originType,
    originId: record.originId,
    originLineId: record.originLineId,
    originActionKey: record.originActionKey,
    reason: record.reason ?? null,
    actor: {
      id: record.actor?.id ?? null,
      name: record.actor?.nome ?? null,
    },
    createdAt: record.createdAt.toISOString(),
  };
}

function formatRestockOrder(record: RestockOrderRecord): RestockOrderDTO {
  return {
    id: record.id,
    status: record.status,
    supplierName: record.supplierName ?? null,
    expectedAt: record.expectedAt?.toISOString() ?? null,
    notes: record.notes ?? null,
    canceledAt: record.canceledAt?.toISOString() ?? null,
    canceledReason: record.canceledReason ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    createdBy: {
      id: record.createdBy.id,
      name: record.createdBy.nome,
    },
    items: record.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      variantId: item.variantId ?? null,
      variantTitle: item.variant?.title ?? null,
      quantityExpected: item.quantityExpected,
      quantityReceived: item.quantityReceived,
      quantityPending: Math.max(item.quantityExpected - item.quantityReceived, 0),
      estimatedUnitCost: item.estimatedUnitCost != null ? moneyToNumber(item.estimatedUnitCost) : null,
    })),
  };
}

async function loadInventoryTarget(
  tx: Tx,
  input: {
    contaId: string;
    productId: string;
    variantId?: string | null;
    allowProductWithVariants?: boolean;
  },
) {
  const product = await tx.product.findFirst({
    where: {
      id: input.productId,
      contaId: input.contaId,
    },
    select: {
      id: true,
      contaId: true,
      name: true,
      sku: true,
      stock: true,
      lowStockThreshold: true,
      hasVariants: true,
      isActive: true,
      archivedAt: true,
      variants: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!product || product.archivedAt) {
    throw new StoreInventoryError('PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.', 404);
  }

  let variant:
    | {
        id: string;
        title: string;
        sku: string | null;
        stock: number;
        lowStockThreshold: number;
        isActive: boolean;
      }
    | null = null;

  if (input.variantId) {
    variant = await tx.productVariant.findFirst({
      where: {
        id: input.variantId,
        productId: input.productId,
      },
      select: {
        id: true,
        title: true,
        sku: true,
        stock: true,
        lowStockThreshold: true,
        isActive: true,
      },
    });

    if (!variant) {
      throw new StoreInventoryError('VARIANTE_NAO_ENCONTRADA', 'Variante não encontrada.', 404);
    }
  } else if (!input.allowProductWithVariants && (product.hasVariants || product.variants.length > 0)) {
    throw new StoreInventoryError(
      'VARIANTE_OBRIGATORIA_ESTOQUE',
      `Selecione uma variante para movimentar o estoque de ${product.name}.`,
      422,
    );
  }

  return {
    product,
    variant,
    inventoryItemKey: buildInventoryItemKey(product.id, variant?.id ?? null),
  };
}

async function findInventoryBalance(
  tx: Tx,
  contaId: string,
  productId: string,
  variantId?: string | null,
): Promise<InventoryBalanceRecord | null> {
  const inventoryItemKey = buildInventoryItemKey(productId, variantId);
  return tx.inventoryBalance.findUnique({
    where: {
      contaId_inventoryItemKey: {
        contaId,
        inventoryItemKey,
      },
    },
    include: INVENTORY_BALANCE_INCLUDE,
  });
}

async function getOrCreateInventoryBalance(
  tx: Tx,
  input: {
    contaId: string;
    productId: string;
    variantId?: string | null;
  },
): Promise<InventoryBalanceRecord> {
  const existing = await findInventoryBalance(tx, input.contaId, input.productId, input.variantId);
  if (existing) return existing;

  const target = await loadInventoryTarget(tx, {
    contaId: input.contaId,
    productId: input.productId,
    variantId: input.variantId,
  });

  const created = await tx.inventoryBalance.create({
    data: {
      contaId: input.contaId,
      inventoryItemKey: target.inventoryItemKey,
      productId: input.productId,
      variantId: target.variant?.id ?? null,
      onHand: target.variant?.stock ?? target.product.stock,
      reserved: 0,
      incoming: 0,
      averageCost: moneyToDecimal(0),
    },
    include: INVENTORY_BALANCE_INCLUDE,
  });

  if (!target.variant) {
    await tx.product.update({
      where: { id: input.productId },
      data: { stock: target.product.stock },
    });
  }

  return created;
}

async function syncLegacyStockMirror(
  tx: Tx,
  input: {
    productId: string;
    variantId?: string | null;
    onHand: number;
  },
): Promise<void> {
  if (input.variantId) {
    await tx.productVariant.update({
      where: { id: input.variantId },
      data: { stock: input.onHand },
    });

    const aggregate = await tx.inventoryBalance.aggregate({
      where: {
        productId: input.productId,
        variantId: { not: null },
      },
      _sum: {
        onHand: true,
      },
    });

    await tx.product.update({
      where: { id: input.productId },
      data: {
        stock: aggregate._sum.onHand ?? 0,
      },
    });

    return;
  }

  await tx.product.update({
    where: { id: input.productId },
    data: { stock: input.onHand },
  });
}

async function applyInventoryChange(
  tx: Tx,
  input: {
    contaId: string;
    actorUserId?: string | null;
    productId: string;
    variantId?: string | null;
    movementType: InventoryMovementType;
    onHandDelta?: number;
    reservedDelta?: number;
    incomingDelta?: number;
    unitCost?: number | null;
    averageCostMode?: 'recalculate' | 'keep';
    originType: string;
    originId: string;
    originLineId?: string | null;
    originActionKey: string;
    reason?: string | null;
  },
): Promise<InventoryBalanceRecord> {
  const originLineId = normalizeText(input.originLineId) ?? 'ROOT';

  const existing = await tx.inventoryMovement.findFirst({
    where: {
      contaId: input.contaId,
      originType: input.originType,
      originId: input.originId,
      originLineId,
      originActionKey: input.originActionKey,
      movementType: input.movementType,
    },
  });

  if (existing) {
    const balance = await findInventoryBalance(tx, input.contaId, input.productId, input.variantId);
    if (!balance) {
      throw new StoreInventoryError(
        'SALDO_INVENTARIO_NAO_ENCONTRADO',
        'Saldo de estoque não encontrado após movimento idempotente.',
        409,
      );
    }
    return balance;
  }

  const balance = await getOrCreateInventoryBalance(tx, {
    contaId: input.contaId,
    productId: input.productId,
    variantId: input.variantId,
  });

  const onHandDelta = input.onHandDelta ?? 0;
  const reservedDelta = input.reservedDelta ?? 0;
  const incomingDelta = input.incomingDelta ?? 0;

  const nextOnHand = balance.onHand + onHandDelta;
  const nextReserved = balance.reserved + reservedDelta;
  const nextIncoming = balance.incoming + incomingDelta;

  if (nextOnHand < 0 || nextReserved < 0 || nextIncoming < 0) {
    throw new StoreInventoryError(
      'MOVIMENTO_ESTOQUE_INVALIDO',
      'A operação geraria um saldo de estoque inválido.',
      409,
    );
  }

  const unitCostDecimal =
    input.unitCost != null ? moneyToDecimal(Math.max(input.unitCost, 0)) : null;
  const currentAverageCost = moneyToNumber(balance.averageCost);
  const nextAverageCost =
    input.averageCostMode === 'recalculate' && onHandDelta > 0 && input.unitCost != null
      ? computeAverageCost(balance.onHand, currentAverageCost, onHandDelta, input.unitCost)
      : currentAverageCost;

  await tx.inventoryBalance.update({
    where: {
      id: balance.id,
    },
    data: {
      onHand: nextOnHand,
      reserved: nextReserved,
      incoming: nextIncoming,
      averageCost: moneyToDecimal(nextAverageCost),
    },
  });

  await tx.inventoryMovement.create({
    data: {
      contaId: input.contaId,
      inventoryItemKey: balance.inventoryItemKey,
      productId: input.productId,
      variantId: input.variantId ?? null,
      movementType: input.movementType,
      onHandBefore: balance.onHand,
      onHandDelta,
      onHandAfter: nextOnHand,
      reservedBefore: balance.reserved,
      reservedDelta,
      reservedAfter: nextReserved,
      incomingBefore: balance.incoming,
      incomingDelta,
      incomingAfter: nextIncoming,
      unitCost: unitCostDecimal,
      totalCost: buildMovementTotalCost({
        movementType: input.movementType,
        unitCost: unitCostDecimal,
        onHandDelta,
        incomingDelta,
      }),
      originType: input.originType,
      originId: input.originId,
      originLineId,
      originActionKey: input.originActionKey,
      actorUserId: input.actorUserId ?? null,
      reason: normalizeText(input.reason),
    },
  });

  await syncLegacyStockMirror(tx, {
    productId: input.productId,
    variantId: input.variantId,
    onHand: nextOnHand,
  });

  const updated = await findInventoryBalance(tx, input.contaId, input.productId, input.variantId);
  if (!updated) {
    throw new StoreInventoryError('SALDO_INVENTARIO_NAO_ENCONTRADO', 'Saldo de estoque não encontrado.', 404);
  }

  return updated;
}

function computeRestockStatus(items: Array<{ quantityExpected: number; quantityReceived: number }>): RestockOrderStatus {
  const totalExpected = items.reduce((sum, item) => sum + item.quantityExpected, 0);
  const totalReceived = items.reduce((sum, item) => sum + item.quantityReceived, 0);

  if (totalReceived <= 0) return RestockOrderStatus.PLANEJADO;
  if (totalReceived >= totalExpected) return RestockOrderStatus.RECEBIDO;
  return RestockOrderStatus.RECEBIDO_PARCIAL;
}

export async function listInventoryBalances(
  input: ListInventoryBalancesInput,
): Promise<InventoryBalanceDTO[]> {
  const search = normalizeText(input.search);

  const records = await prisma.inventoryBalance.findMany({
    where: {
      contaId: input.contaId,
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(search
        ? {
            OR: [
              {
                product: {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                product: {
                  sku: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                variant: {
                  title: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                variant: {
                  sku: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: INVENTORY_BALANCE_INCLUDE,
    orderBy: [{ product: { name: 'asc' } }, { variant: { title: 'asc' } }],
  });

  let data = records.map(formatBalanceRecord);

  if (!input.includeInactive) {
    data = data.filter((item) => item.isActive);
  }

  if (input.lowOnly) {
    data = data.filter((item) => item.alertState === 'LOW' || item.alertState === 'OUT');
  }

  return data;
}

export async function listInventoryMovements(
  input: ListInventoryMovementsInput,
): Promise<InventoryMovementDTO[]> {
  const search = normalizeText(input.search);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_MOVEMENTS_LIMIT, 200));

  const records = await prisma.inventoryMovement.findMany({
    where: {
      contaId: input.contaId,
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.variantId ? { variantId: input.variantId } : {}),
      ...(input.movementType ? { movementType: input.movementType } : {}),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.originType ? { originType: input.originType } : {}),
      ...(input.fromDate || input.toDate
        ? {
            createdAt: {
              ...(input.fromDate ? { gte: new Date(`${normalizeDateInput(input.fromDate)}T00:00:00.000Z`) } : {}),
              ...(input.toDate ? { lte: new Date(`${normalizeDateInput(input.toDate)}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                product: {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                variant: {
                  title: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                reason: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    },
    include: INVENTORY_MOVEMENT_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return records.map(formatMovementRecord);
}

export async function registerInventoryEntry(
  input: RegisterInventoryEntryInput,
): Promise<InventoryBalanceDTO> {
  if (!normalizeText(input.requestId)) {
    throw new StoreInventoryError('REQUEST_ID_OBRIGATORIO', 'requestId é obrigatório.', 422);
  }

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'Informe uma quantidade válida.', 422);
  }

  if (Number.isNaN(input.unitCost) || input.unitCost < 0) {
    throw new StoreInventoryError('CUSTO_INVALIDO', 'Informe um custo unitário válido.', 422);
  }

  const balance = await prisma.$transaction(async (tx) => {
    const target = await loadInventoryTarget(tx, {
      contaId: input.contaId,
      productId: input.productId,
      variantId: input.variantId,
    });

    return applyInventoryChange(tx, {
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      productId: target.product.id,
      variantId: target.variant?.id ?? null,
      movementType: InventoryMovementType.ENTRY_IN,
      onHandDelta: input.quantity,
      unitCost: input.unitCost,
      averageCostMode: 'recalculate',
      originType: 'MANUAL_ENTRY',
      originId: input.requestId,
      originActionKey: 'create',
      reason: [normalizeText(input.supplierName), normalizeText(input.reason)].filter(Boolean).join(' · '),
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.inventory.entry.created',
    entity: {
      type: 'InventoryBalance',
      id: balance.id,
    },
    metadata: {
      inventoryItemKey: balance.inventoryItemKey,
      productId: balance.productId,
      variantId: balance.variantId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      requestId: input.requestId,
    },
  });

  return formatBalanceRecord(balance);
}

export async function adjustInventory(
  input: AdjustInventoryInput,
): Promise<InventoryBalanceDTO> {
  if (!normalizeText(input.requestId)) {
    throw new StoreInventoryError('REQUEST_ID_OBRIGATORIO', 'requestId é obrigatório.', 422);
  }

  if (!Number.isFinite(input.quantity)) {
    throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'Informe uma quantidade válida.', 422);
  }

  const balance = await prisma.$transaction(async (tx) => {
    const target = await loadInventoryTarget(tx, {
      contaId: input.contaId,
      productId: input.productId,
      variantId: input.variantId,
    });

    const current = await getOrCreateInventoryBalance(tx, {
      contaId: input.contaId,
      productId: target.product.id,
      variantId: target.variant?.id ?? null,
    });

    const delta = input.mode === 'SET' ? input.quantity - current.onHand : input.quantity;
    if (!Number.isInteger(delta)) {
      throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'O ajuste deve resultar em quantidade inteira.', 422);
    }

    const movementType =
      delta > 0
        ? InventoryMovementType.ADJUST_IN
        : input.reasonCode === 'LOSS' || input.reasonCode === 'DAMAGE'
          ? InventoryMovementType.LOSS_OUT
          : InventoryMovementType.ADJUST_OUT;

    return applyInventoryChange(tx, {
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      productId: target.product.id,
      variantId: target.variant?.id ?? null,
      movementType,
      onHandDelta: delta,
      unitCost: delta > 0 ? moneyToNumber(current.averageCost) : null,
      averageCostMode: 'keep',
      originType: 'MANUAL_ADJUSTMENT',
      originId: input.requestId,
      originActionKey: input.mode === 'SET' ? 'set' : 'delta',
      reason: [input.reasonCode, normalizeText(input.note)].filter(Boolean).join(' · '),
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.inventory.adjustment.created',
    entity: {
      type: 'InventoryBalance',
      id: balance.id,
    },
    metadata: {
      inventoryItemKey: balance.inventoryItemKey,
      productId: balance.productId,
      variantId: balance.variantId,
      mode: input.mode,
      quantity: input.quantity,
      reasonCode: input.reasonCode,
      requestId: input.requestId,
    },
  });

  return formatBalanceRecord(balance);
}

export async function listRestockOrders(
  input: ListRestockOrdersInput,
): Promise<RestockOrderDTO[]> {
  const search = normalizeText(input.search);
  const records = await prisma.restockOrder.findMany({
    where: {
      contaId: input.contaId,
      ...(input.status && input.status !== 'TODOS' ? { status: input.status } : {}),
      ...(search
        ? {
            OR: [
              {
                supplierName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                items: {
                  some: {
                    product: {
                      name: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
              {
                items: {
                  some: {
                    variant: {
                      title: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: RESTOCK_ORDER_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return records.map(formatRestockOrder);
}

export async function createRestockOrder(
  input: CreateRestockOrderInput,
): Promise<RestockOrderDTO> {
  if (!normalizeText(input.requestId)) {
    throw new StoreInventoryError('REQUEST_ID_OBRIGATORIO', 'requestId é obrigatório.', 422);
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StoreInventoryError('ITENS_OBRIGATORIOS', 'Adicione ao menos um item para reposição.', 422);
  }

  const expectedAt = normalizeDateInput(input.expectedAt);

  const order = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.restockOrder.create({
      data: {
        contaId: input.contaId,
        supplierName: normalizeText(input.supplierName),
        expectedAt: expectedAt ? new Date(`${expectedAt}T12:00:00.000Z`) : null,
        notes: normalizeText(input.notes),
        createdById: input.actorUserId,
      },
      include: RESTOCK_ORDER_INCLUDE,
    });

    for (const rawItem of input.items) {
      if (!Number.isInteger(rawItem.quantity) || rawItem.quantity <= 0) {
        throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'A quantidade esperada deve ser positiva.', 422);
      }

      if (Number.isNaN(rawItem.unitCost) || rawItem.unitCost < 0) {
        throw new StoreInventoryError('CUSTO_INVALIDO', 'O custo estimado deve ser válido.', 422);
      }

      const target = await loadInventoryTarget(tx, {
        contaId: input.contaId,
        productId: rawItem.productId,
        variantId: rawItem.variantId,
      });

      const createdItem = await tx.restockOrderItem.create({
        data: {
          restockOrderId: createdOrder.id,
          productId: target.product.id,
          variantId: target.variant?.id ?? null,
          quantityExpected: rawItem.quantity,
          estimatedUnitCost: moneyToDecimal(rawItem.unitCost),
        },
      });

      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: target.product.id,
        variantId: target.variant?.id ?? null,
        movementType: InventoryMovementType.RESTOCK_IN,
        incomingDelta: rawItem.quantity,
        unitCost: rawItem.unitCost,
        averageCostMode: 'keep',
        originType: 'RESTOCK_ORDER',
        originId: createdOrder.id,
        originLineId: createdItem.id,
        originActionKey: 'planned',
        reason: [normalizeText(input.supplierName), normalizeText(input.notes)].filter(Boolean).join(' · '),
      });
    }

    return tx.restockOrder.findFirstOrThrow({
      where: { id: createdOrder.id, contaId: input.contaId },
      include: RESTOCK_ORDER_INCLUDE,
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.restock.created',
    entity: {
      type: 'RestockOrder',
      id: order.id,
    },
    metadata: {
      requestId: input.requestId,
      items: order.items.length,
      status: order.status,
    },
  });

  return formatRestockOrder(order);
}

export async function receiveRestockOrder(
  input: ReceiveRestockOrderInput,
): Promise<RestockOrderDTO> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StoreInventoryError('ITENS_OBRIGATORIOS', 'Informe os itens recebidos.', 422);
  }

  const order = await prisma.$transaction(async (tx) => {
    const currentOrder = await tx.restockOrder.findFirst({
      where: {
        id: input.restockOrderId,
        contaId: input.contaId,
      },
      include: RESTOCK_ORDER_INCLUDE,
    });

    if (!currentOrder) {
      throw new StoreInventoryError('REPOSICAO_NAO_ENCONTRADA', 'Reposição não encontrada.', 404);
    }

    if (currentOrder.status === RestockOrderStatus.CANCELADO) {
      throw new StoreInventoryError('REPOSICAO_CANCELADA', 'Esta reposição já foi cancelada.', 409);
    }

    for (const receipt of input.items) {
      const orderItem = currentOrder.items.find((item) => item.id === receipt.itemId);
      if (!orderItem) {
        throw new StoreInventoryError('ITEM_REPOSICAO_NAO_ENCONTRADO', 'Item da reposição não encontrado.', 404);
      }

      if (!Number.isInteger(receipt.quantityReceived) || receipt.quantityReceived <= 0) {
        throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'A quantidade recebida deve ser positiva.', 422);
      }

      const pending = orderItem.quantityExpected - orderItem.quantityReceived;
      if (receipt.quantityReceived > pending) {
        throw new StoreInventoryError(
          'QUANTIDADE_RECEBIDA_INVALIDA',
          `A quantidade recebida para ${orderItem.product.name} excede o saldo pendente.`,
          422,
        );
      }

      const unitCost =
        receipt.unitCost != null ? receipt.unitCost : orderItem.estimatedUnitCost != null ? moneyToNumber(orderItem.estimatedUnitCost) : null;

      if (unitCost == null || Number.isNaN(unitCost) || unitCost < 0) {
        throw new StoreInventoryError(
          'CUSTO_INVALIDO',
          `Informe um custo unitário válido para ${orderItem.product.name}.`,
          422,
        );
      }

      await tx.restockOrderItem.update({
        where: { id: orderItem.id },
        data: {
          quantityReceived: {
            increment: receipt.quantityReceived,
          },
          estimatedUnitCost: moneyToDecimal(unitCost),
        },
      });

      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: orderItem.productId,
        variantId: orderItem.variantId ?? null,
        movementType: InventoryMovementType.RESTOCK_IN,
        onHandDelta: receipt.quantityReceived,
        incomingDelta: -receipt.quantityReceived,
        unitCost,
        averageCostMode: 'recalculate',
        originType: 'RESTOCK_ORDER',
        originId: currentOrder.id,
        originLineId: orderItem.id,
        originActionKey: `receive:${orderItem.quantityReceived + receipt.quantityReceived}`,
        reason: [normalizeText(currentOrder.supplierName), 'recebimento'].filter(Boolean).join(' · '),
      });
    }

    const refreshedItems = await tx.restockOrderItem.findMany({
      where: {
        restockOrderId: currentOrder.id,
      },
      select: {
        quantityExpected: true,
        quantityReceived: true,
      },
    });

    const nextStatus = computeRestockStatus(refreshedItems);

    await tx.restockOrder.update({
      where: { id: currentOrder.id },
      data: {
        status: nextStatus,
      },
    });

    return tx.restockOrder.findFirstOrThrow({
      where: { id: currentOrder.id, contaId: input.contaId },
      include: RESTOCK_ORDER_INCLUDE,
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.restock.received',
    entity: {
      type: 'RestockOrder',
      id: order.id,
    },
    metadata: {
      status: order.status,
      itemsReceived: input.items.length,
    },
  });

  return formatRestockOrder(order);
}

export async function cancelRestockOrder(
  input: CancelRestockOrderInput,
): Promise<RestockOrderDTO> {
  const order = await prisma.$transaction(async (tx) => {
    const currentOrder = await tx.restockOrder.findFirst({
      where: {
        id: input.restockOrderId,
        contaId: input.contaId,
      },
      include: RESTOCK_ORDER_INCLUDE,
    });

    if (!currentOrder) {
      throw new StoreInventoryError('REPOSICAO_NAO_ENCONTRADA', 'Reposição não encontrada.', 404);
    }

    if (currentOrder.status === RestockOrderStatus.CANCELADO) {
      return currentOrder;
    }

    for (const item of currentOrder.items) {
      const pending = item.quantityExpected - item.quantityReceived;
      if (pending <= 0) continue;

      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        movementType: InventoryMovementType.RESTOCK_IN,
        incomingDelta: -pending,
        unitCost: item.estimatedUnitCost != null ? moneyToNumber(item.estimatedUnitCost) : 0,
        averageCostMode: 'keep',
        originType: 'RESTOCK_ORDER',
        originId: currentOrder.id,
        originLineId: item.id,
        originActionKey: 'cancel',
        reason: [normalizeText(input.reason), 'cancelamento'].filter(Boolean).join(' · '),
      });
    }

    await tx.restockOrder.update({
      where: { id: currentOrder.id },
      data: {
        status: RestockOrderStatus.CANCELADO,
        canceledAt: new Date(),
        canceledReason: normalizeText(input.reason),
      },
    });

    return tx.restockOrder.findFirstOrThrow({
      where: { id: currentOrder.id, contaId: input.contaId },
      include: RESTOCK_ORDER_INCLUDE,
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.restock.canceled',
    entity: {
      type: 'RestockOrder',
      id: order.id,
    },
    metadata: {
      reason: normalizeText(input.reason),
      status: order.status,
    },
  });

  return formatRestockOrder(order);
}

export async function applySaleInventoryOnCreate(
  tx: Tx,
  input: {
    contaId: string;
    actorUserId: string;
    saleId: string;
    items: SaleInventoryLineInput[];
    inventoryMode: SaleInventoryMode;
  },
): Promise<void> {
  for (const item of input.items) {
    if (!item.productId) {
      throw new StoreInventoryError(
        'PRODUTO_NAO_ENCONTRADO',
        `Item ${item.productName} não possui produto associado para estoque.`,
        409,
      );
    }

    const balance = await getOrCreateInventoryBalance(tx, {
      contaId: input.contaId,
      productId: item.productId,
      variantId: item.variantId,
    });

    const available = calculateAvailable(balance);
    if (available < item.quantity) {
      throw new StoreInventoryError(
        'ESTOQUE_INSUFICIENTE',
        `Estoque insuficiente para ${item.productName}. Disponível: ${available}.`,
        409,
      );
    }

    await applyInventoryChange(tx, {
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      productId: item.productId,
      variantId: item.variantId,
      movementType:
        input.inventoryMode === SaleInventoryMode.RESERVE
          ? InventoryMovementType.RESERVE
          : InventoryMovementType.SALE_OUT,
      onHandDelta: input.inventoryMode === SaleInventoryMode.IMMEDIATE ? -item.quantity : 0,
      reservedDelta: input.inventoryMode === SaleInventoryMode.RESERVE ? item.quantity : 0,
      averageCostMode: 'keep',
      originType: 'SALE',
      originId: input.saleId,
      originLineId: item.saleItemId,
      originActionKey: input.inventoryMode === SaleInventoryMode.RESERVE ? 'reserve' : 'sale-out',
      reason: item.productName,
    });
  }
}

async function restoreInventoryForCanceledSale(
  tx: Tx,
  input: {
    contaId: string;
    actorUserId: string;
    saleId: string;
    inventoryStatus: SaleInventoryStatus;
    items: Array<{
      id: string;
      productId: string | null;
      variantId: string | null;
      productName: string;
      quantity: number;
      returnedQuantity: number;
    }>;
  },
): Promise<void> {
  for (const item of input.items) {
    if (!item.productId) continue;

    const effectiveQuantity = Math.max(item.quantity - item.returnedQuantity, 0);
    if (effectiveQuantity <= 0) continue;

    if (input.inventoryStatus === SaleInventoryStatus.RESERVED) {
      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: item.productId,
        variantId: item.variantId,
        movementType: InventoryMovementType.RELEASE,
        reservedDelta: -effectiveQuantity,
        averageCostMode: 'keep',
        originType: 'SALE',
        originId: input.saleId,
        originLineId: item.id,
        originActionKey: 'cancel',
        reason: 'Cancelamento de venda reservada',
      });
      continue;
    }

    await applyInventoryChange(tx, {
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      productId: item.productId,
      variantId: item.variantId,
      movementType: InventoryMovementType.RETURN_IN,
      onHandDelta: effectiveQuantity,
      unitCost: null,
      averageCostMode: 'keep',
      originType: 'SALE',
      originId: input.saleId,
      originLineId: item.id,
      originActionKey: 'cancel',
      reason: 'Cancelamento de venda com retorno ao estoque',
    });
  }
}

export async function fulfillReservedSale(
  input: FulfillReservedSaleInput,
): Promise<{
  inventoryStatus: SaleInventoryStatus;
}> {
  const sale = await prisma.$transaction(async (tx) => {
    const currentSale = await tx.sale.findFirst({
      where: {
        id: input.saleId,
        contaId: input.contaId,
      },
      select: {
        id: true,
        status: true,
        inventoryStatus: true,
        inventoryMode: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productId: true,
            variantId: true,
            productName: true,
            quantity: true,
            returnedQuantity: true,
          },
        },
      },
    });

    if (!currentSale) {
      throw new StoreInventoryError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    }

    if (currentSale.status === SaleStatus.CANCELADA) {
      throw new StoreInventoryError('VENDA_CANCELADA', 'A venda já foi cancelada.', 409);
    }

    if (currentSale.inventoryMode !== SaleInventoryMode.RESERVE) {
      throw new StoreInventoryError(
        'VENDA_SEM_RESERVA',
        'A venda não está configurada para reserva de estoque.',
        409,
      );
    }

    if (currentSale.inventoryStatus !== SaleInventoryStatus.RESERVED) {
      return currentSale;
    }

    for (const item of currentSale.items) {
      if (!item.productId) continue;

      const outstanding = Math.max(item.quantity - item.returnedQuantity, 0);
      if (outstanding <= 0) continue;

      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: item.productId,
        variantId: item.variantId,
        movementType: InventoryMovementType.SALE_OUT,
        onHandDelta: -outstanding,
        reservedDelta: -outstanding,
        averageCostMode: 'keep',
        originType: 'SALE',
        originId: currentSale.id,
        originLineId: item.id,
        originActionKey: 'fulfill',
        reason: 'Cumprimento de venda reservada',
      });
    }

    return tx.sale.update({
      where: { id: currentSale.id },
      data: {
        inventoryStatus: SaleInventoryStatus.FULFILLED,
      },
      select: {
        inventoryStatus: true,
      },
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.sale.fulfilled',
    entity: {
      type: 'Sale',
      id: input.saleId,
    },
    metadata: {
      inventoryStatus: sale.inventoryStatus,
    },
  });

  return {
    inventoryStatus: sale.inventoryStatus,
  };
}

export async function registerSaleReturn(
  input: RegisterSaleReturnInput,
): Promise<{
  inventoryStatus: SaleInventoryStatus;
}> {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StoreInventoryError('ITENS_OBRIGATORIOS', 'Informe os itens devolvidos.', 422);
  }

  const sale = await prisma.$transaction(async (tx) => {
    const currentSale = await tx.sale.findFirst({
      where: {
        id: input.saleId,
        contaId: input.contaId,
      },
      select: {
        id: true,
        status: true,
        inventoryStatus: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productId: true,
            variantId: true,
            quantity: true,
            returnedQuantity: true,
            productName: true,
          },
        },
      },
    });

    if (!currentSale) {
      throw new StoreInventoryError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    }

    if (currentSale.status === SaleStatus.CANCELADA) {
      throw new StoreInventoryError('VENDA_CANCELADA', 'Não é possível devolver uma venda cancelada.', 409);
    }

    if (
      currentSale.inventoryStatus === SaleInventoryStatus.RESERVED ||
      currentSale.inventoryStatus === SaleInventoryStatus.CANCELED
    ) {
      throw new StoreInventoryError(
        'VENDA_SEM_SAIDA_FISICA',
        'A venda ainda não teve saída física para permitir devolução.',
        409,
      );
    }

    for (const rawItem of input.items) {
      const saleItem = currentSale.items.find((item) => item.id === rawItem.saleItemId);
      if (!saleItem || !saleItem.productId) {
        throw new StoreInventoryError('ITEM_VENDA_NAO_ENCONTRADO', 'Item da venda não encontrado.', 404);
      }

      if (!Number.isInteger(rawItem.quantity) || rawItem.quantity <= 0) {
        throw new StoreInventoryError('QUANTIDADE_INVALIDA', 'A quantidade devolvida deve ser positiva.', 422);
      }

      const remaining = saleItem.quantity - saleItem.returnedQuantity;
      if (rawItem.quantity > remaining) {
        throw new StoreInventoryError(
          'QUANTIDADE_DEVOLUCAO_INVALIDA',
          `A devolução de ${saleItem.productName} excede a quantidade ainda aberta.`,
          422,
        );
      }

      await tx.saleItem.update({
        where: { id: saleItem.id },
        data: {
          returnedQuantity: {
            increment: rawItem.quantity,
          },
        },
      });

      await applyInventoryChange(tx, {
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        productId: saleItem.productId,
        variantId: saleItem.variantId,
        movementType: InventoryMovementType.RETURN_IN,
        onHandDelta: rawItem.quantity,
        averageCostMode: 'keep',
        originType: 'SALE',
        originId: currentSale.id,
        originLineId: saleItem.id,
        originActionKey: `return:${saleItem.returnedQuantity + rawItem.quantity}`,
        reason: normalizeText(input.reason) ?? 'Devolução de venda',
      });
    }

    const refreshedItems = await tx.saleItem.findMany({
      where: {
        saleId: currentSale.id,
      },
      select: {
        quantity: true,
        returnedQuantity: true,
      },
    });

    const allReturned = refreshedItems.every((item) => item.returnedQuantity >= item.quantity);
    const someReturned = refreshedItems.some((item) => item.returnedQuantity > 0);
    const nextStatus = allReturned
      ? SaleInventoryStatus.RETURNED_TOTAL
      : someReturned
        ? SaleInventoryStatus.RETURNED_PARTIAL
        : SaleInventoryStatus.FULFILLED;

    return tx.sale.update({
      where: { id: currentSale.id },
      data: {
        inventoryStatus: nextStatus,
      },
      select: {
        inventoryStatus: true,
      },
    });
  });

  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorUserId },
    action: 'loja.sale.returned',
    entity: {
      type: 'Sale',
      id: input.saleId,
    },
    metadata: {
      inventoryStatus: sale.inventoryStatus,
      reason: normalizeText(input.reason),
    },
  });

  return {
    inventoryStatus: sale.inventoryStatus,
  };
}

export async function cancelSaleInventory(
  input: {
    contaId: string;
    actorUserId: string;
    saleId: string;
  },
): Promise<{
  inventoryStatus: SaleInventoryStatus;
}> {
  const sale = await prisma.$transaction(async (tx) => {
    const currentSale = await tx.sale.findFirst({
      where: {
        id: input.saleId,
        contaId: input.contaId,
      },
      select: {
        id: true,
        inventoryStatus: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productId: true,
            variantId: true,
            productName: true,
            quantity: true,
            returnedQuantity: true,
          },
        },
      },
    });

    if (!currentSale) {
      throw new StoreInventoryError('VENDA_NAO_ENCONTRADA', 'Venda não encontrada.', 404);
    }

    if (currentSale.inventoryStatus === SaleInventoryStatus.CANCELED) {
      return currentSale;
    }

    await restoreInventoryForCanceledSale(tx, {
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      saleId: currentSale.id,
      inventoryStatus: currentSale.inventoryStatus,
      items: currentSale.items,
    });

    return tx.sale.update({
      where: { id: currentSale.id },
      data: {
        inventoryStatus: SaleInventoryStatus.CANCELED,
      },
      select: {
        inventoryStatus: true,
      },
    });
  });

  return {
    inventoryStatus: sale.inventoryStatus,
  };
}
