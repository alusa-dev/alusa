import type { RestockOrderStatus } from '@prisma/client';

export interface RestockOrderItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantTitle: string | null;
  quantityExpected: number;
  quantityReceived: number;
  quantityPending: number;
  estimatedUnitCost: number | null;
}

export interface RestockOrder {
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
  items: RestockOrderItem[];
}

type RestockResponse<T> = {
  data: T;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível concluir a operação de reposição.';
    throw new Error(message);
  }

  return json as T;
}

export async function listRestockOrders(params: {
  status?: RestockOrderStatus | 'TODOS';
  search?: string;
} = {}): Promise<RestockOrder[]> {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.search?.trim()) searchParams.set('search', params.search.trim());

  const response = await fetch(`/api/vendas/reposicoes?${searchParams.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const json = await parseResponse<RestockResponse<RestockOrder[]>>(response);
  return Array.isArray(json.data) ? json.data : [];
}

export async function createRestockOrder(payload: {
  requestId?: string;
  supplierName?: string | null;
  expectedAt?: string | null;
  notes?: string | null;
  items: Array<{
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitCost: number;
  }>;
}): Promise<RestockOrder> {
  const response = await fetch('/api/vendas/reposicoes', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<RestockResponse<RestockOrder>>(response);
  return json.data;
}

export async function receiveRestockOrder(
  id: string,
  payload: {
    items: Array<{
      itemId: string;
      quantityReceived: number;
      unitCost?: number | null;
    }>;
  },
): Promise<RestockOrder> {
  const response = await fetch(`/api/vendas/reposicoes/${id}/recebimentos`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseResponse<RestockResponse<RestockOrder>>(response);
  return json.data;
}

export async function cancelRestockOrder(id: string, reason?: string): Promise<RestockOrder> {
  const response = await fetch(`/api/vendas/reposicoes/${id}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });

  const json = await parseResponse<RestockResponse<RestockOrder>>(response);
  return json.data;
}
