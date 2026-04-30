import type { InventoryMovementType } from '@prisma/client';

export type InventoryAlertState = 'OUT' | 'LOW' | 'OK';

export interface InventoryBalanceItem {
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
}

export interface InventoryMovementItem {
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
}

type InventoryResponse<T> = {
  data: T;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível concluir a operação de estoque.';
    throw new Error(message);
  }

  return json as T;
}

export async function listInventoryBalances(params: {
  search?: string;
  productId?: string;
  variantId?: string;
  lowOnly?: boolean;
  includeInactive?: boolean;
} = {}): Promise<InventoryBalanceItem[]> {
  const searchParams = new URLSearchParams();
  if (params.search?.trim()) searchParams.set('search', params.search.trim());
  if (params.productId) searchParams.set('productId', params.productId);
  if (params.variantId) searchParams.set('variantId', params.variantId);
  if (params.lowOnly) searchParams.set('lowOnly', 'true');
  if (params.includeInactive) searchParams.set('includeInactive', 'true');

  const response = await fetch(`/api/vendas/estoque?${searchParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const json = await parseResponse<InventoryResponse<InventoryBalanceItem[]>>(response);
  return Array.isArray(json.data) ? json.data : [];
}

export async function listInventoryMovements(params: {
  productId?: string;
  variantId?: string;
  movementType?: InventoryMovementType;
  search?: string;
  fromDate?: string;
  toDate?: string;
  actorUserId?: string;
  originType?: string;
  limit?: number;
} = {}): Promise<InventoryMovementItem[]> {
  const searchParams = new URLSearchParams();
  if (params.productId) searchParams.set('productId', params.productId);
  if (params.variantId) searchParams.set('variantId', params.variantId);
  if (params.movementType) searchParams.set('movementType', params.movementType);
  if (params.search?.trim()) searchParams.set('search', params.search.trim());
  if (params.fromDate) searchParams.set('fromDate', params.fromDate);
  if (params.toDate) searchParams.set('toDate', params.toDate);
  if (params.actorUserId) searchParams.set('actorUserId', params.actorUserId);
  if (params.originType) searchParams.set('originType', params.originType);
  if (params.limit) searchParams.set('limit', String(params.limit));

  const response = await fetch(`/api/vendas/estoque/movimentos?${searchParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const json = await parseResponse<InventoryResponse<InventoryMovementItem[]>>(response);
  return Array.isArray(json.data) ? json.data : [];
}

export async function registerInventoryEntry(payload: {
  requestId?: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitCost: number;
  supplierName?: string | null;
  reason?: string | null;
}): Promise<InventoryBalanceItem> {
  const response = await fetch('/api/vendas/estoque/entradas', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<InventoryResponse<InventoryBalanceItem>>(response);
  return json.data;
}

export async function adjustInventory(payload: {
  requestId?: string;
  productId: string;
  variantId?: string | null;
  mode: 'SET' | 'DELTA';
  quantity: number;
  reasonCode: 'COUNT' | 'LOSS' | 'DAMAGE' | 'CORRECTION';
  note?: string | null;
}): Promise<InventoryBalanceItem> {
  const response = await fetch('/api/vendas/estoque/ajustes', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<InventoryResponse<InventoryBalanceItem>>(response);
  return json.data;
}
