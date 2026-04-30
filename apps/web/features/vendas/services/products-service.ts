import { calculatePricingMetrics } from '../pricing-utils';

export interface ProductCategory {
  id: string;
  name: string;
  contaId: string;
}

export interface ProductInventoryVariantSummary {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  salePrice: number;
  stock: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
  lowStockThreshold: number;
  isActive: boolean;
  averageCost: number;
  inventoryValue: number;
  profitPerUnit: number;
  marginPercent: number;
}

export interface ProductListItem {
  id: string;
  contaId: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: number;
  referencePrice: number;
  stock: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
  averageCost: number;
  inventoryValue: number;
  profitPerUnit: number;
  marginPercent: number;
  lowStockThreshold: number;
  categoryId: string | null;
  category: ProductCategory | null;
  isActive: boolean;
  hasVariants: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  primaryImageUrl: string | null;
  totalStock: number;
  totalAvailable: number;
  totalIncoming: number;
  stockAlertState: 'OUT' | 'LOW' | 'OK';
  variants?: ProductInventoryVariantSummary[];
}

export interface ListProductsParams {
  q?: string;
  categoryId?: string;
  archived?: boolean;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface ListProductsResult {
  data: ProductListItem[];
  meta: { page: number; pageSize: number; total: number };
}

function normalizeProduct(input: Record<string, unknown>): ProductListItem {
  const cat = input.category as Record<string, unknown> | null;
  const productPrice = Number(input.price ?? 0);
  const rawVariants = ((input.variants as Array<Record<string, unknown>> | undefined) ?? []).map(
    (variant) => ({
      id: String(variant.id ?? ''),
      title: String(variant.title ?? ''),
      sku: variant.sku != null ? String(variant.sku) : null,
      price: variant.price != null ? Number(variant.price) : null,
      salePrice: variant.price != null ? Number(variant.price) : productPrice,
      stock: Number(variant.stock ?? variant.onHand ?? 0),
      onHand: Number(variant.onHand ?? variant.stock ?? 0),
      reserved: Number(variant.reserved ?? 0),
      available: Number(variant.available ?? variant.stock ?? variant.onHand ?? 0),
      incoming: Number(variant.incoming ?? 0),
      projected: Number(
        variant.projected ?? variant.available ?? variant.stock ?? variant.onHand ?? 0,
      ),
      lowStockThreshold: Number(variant.lowStockThreshold ?? 0),
      isActive: variant.isActive !== false,
      averageCost: Number(variant.averageCost ?? 0),
      inventoryValue: Number(variant.inventoryValue ?? 0),
    }),
  );
  const variants = rawVariants.map((variant) => {
    const metrics = calculatePricingMetrics(variant.salePrice, variant.averageCost);

    return {
      ...variant,
      profitPerUnit: metrics.profitPerUnit,
      marginPercent: metrics.marginPercent,
    };
  });
  const activeVariants = variants.filter((variant) => variant.isActive !== false);
  const onHand = Number(input.onHand ?? input.stock ?? 0);
  const available = Number(input.available ?? onHand);
  const incoming = Number(input.incoming ?? 0);
  const hasVariants = input.hasVariants === true;
  const totalStock =
    hasVariants && activeVariants.length > 0
      ? activeVariants.reduce((sum, variant) => sum + Number(variant.onHand ?? 0), 0)
      : onHand;
  const totalAvailable =
    hasVariants && activeVariants.length > 0
      ? activeVariants.reduce((sum, variant) => sum + Number(variant.available ?? 0), 0)
      : available;
  const totalIncoming =
    hasVariants && activeVariants.length > 0
      ? activeVariants.reduce((sum, variant) => sum + Number(variant.incoming ?? 0), 0)
      : incoming;
  const variantInventoryValue = activeVariants.reduce(
    (sum, variant) => sum + variant.inventoryValue,
    0,
  );
  const variantWeightedRevenue = activeVariants.reduce(
    (sum, variant) => sum + variant.salePrice * Math.max(variant.onHand, 0),
    0,
  );
  const averageCost = hasVariants
    ? totalStock > 0
      ? Number((variantInventoryValue / totalStock).toFixed(4))
      : 0
    : Number(input.averageCost ?? 0);
  const referencePrice =
    hasVariants && totalStock > 0
      ? Number((variantWeightedRevenue / totalStock).toFixed(2))
      : productPrice;
  const pricing = calculatePricingMetrics(referencePrice, averageCost);
  const inventoryValue = hasVariants
    ? Number(variantInventoryValue.toFixed(4))
    : Number(input.inventoryValue ?? 0);
  const stockAlertState: ProductListItem['stockAlertState'] = (() => {
    if (totalAvailable <= 0) return 'OUT';

    if (hasVariants && activeVariants.length > 0) {
      return activeVariants.some(
        (variant) =>
          Number(variant.available ?? 0) <= Math.max(Number(variant.lowStockThreshold ?? 0), 0),
      )
        ? 'LOW'
        : 'OK';
    }

    return available <= Math.max(Number(input.lowStockThreshold ?? 0), 0) ? 'LOW' : 'OK';
  })();

  return {
    id: String(input.id ?? ''),
    contaId: String(input.contaId ?? ''),
    name: String(input.name ?? ''),
    description: input.description != null ? String(input.description) : null,
    sku: input.sku != null ? String(input.sku) : null,
    price: productPrice,
    referencePrice,
    stock: onHand,
    onHand,
    reserved: Number(input.reserved ?? 0),
    available,
    incoming,
    projected: Number(input.projected ?? available + incoming),
    averageCost,
    inventoryValue,
    profitPerUnit: pricing.profitPerUnit,
    marginPercent: pricing.marginPercent,
    lowStockThreshold: Number(input.lowStockThreshold ?? 5),
    categoryId: input.categoryId != null ? String(input.categoryId) : null,
    category: cat
      ? {
          id: String(cat.id ?? ''),
          name: String(cat.name ?? ''),
          contaId: String(cat.contaId ?? ''),
        }
      : null,
    isActive: input.isActive !== false,
    hasVariants,
    archivedAt: input.archivedAt != null ? String(input.archivedAt) : null,
    createdAt: String(input.createdAt ?? ''),
    updatedAt: String(input.updatedAt ?? ''),
    primaryImageUrl: (() => {
      const imgs = input.images as Array<{ url: string }> | undefined;
      if (!imgs || imgs.length === 0) return null;
      return imgs[0].url.replace(/^\/public\//, '/');
    })(),
    totalStock,
    totalAvailable,
    totalIncoming,
    stockAlertState,
    variants,
  };
}

export async function listProducts(opts: ListProductsParams = {}): Promise<ListProductsResult> {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  if (opts.categoryId) params.set('categoryId', opts.categoryId);
  if (opts.archived) params.set('archived', 'true');
  if (opts.activeOnly) params.set('activeOnly', 'true');
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));

  const response = await fetch(`/api/vendas/produtos?${params.toString()}`, {
    method: 'GET',
    signal: opts.signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível listar os produtos.';
    throw new Error(message);
  }

  const data = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: unknown[] }).data as Record<string, unknown>[]).map(normalizeProduct)
    : [];
  const meta = (json as { meta?: { page: number; pageSize: number; total: number } })?.meta ?? {
    page: 1,
    pageSize: 50,
    total: 0,
  };

  return { data, meta };
}

export interface CreateProductPayload {
  name: string;
  description?: string;
  sku?: string;
  price: number;
  averageCost?: number;
  initialStock?: number;
  lowStockThreshold?: number;
  categoryId?: string | null;
}

export async function createProduct(payload: CreateProductPayload): Promise<ProductListItem> {
  const response = await fetch('/api/vendas/produtos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível criar o produto.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao criar produto.');
  return normalizeProduct(data);
}

export async function updateProduct(
  id: string,
  payload: Partial<CreateProductPayload>,
): Promise<ProductListItem> {
  const response = await fetch(`/api/vendas/produtos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível atualizar o produto.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar produto.');
  return normalizeProduct(data);
}

export async function archiveProduct(id: string): Promise<void> {
  const response = await fetch(`/api/vendas/produtos/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível arquivar o produto.';
    throw new Error(message);
  }
}

export async function deleteProduct(id: string): Promise<void> {
  const response = await fetch(`/api/vendas/produtos/${id}?permanent=true`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível excluir o produto.';
    throw new Error(message);
  }
}

export async function toggleProductActive(id: string, isActive: boolean): Promise<ProductListItem> {
  const response = await fetch(`/api/vendas/produtos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ isActive }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível atualizar o status do produto.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar status do produto.');
  return normalizeProduct(data);
}

export async function restoreProduct(id: string): Promise<ProductListItem> {
  const response = await fetch(`/api/vendas/produtos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ restore: true }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível restaurar o produto.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao restaurar produto.');
  return normalizeProduct(data);
}

export async function listCategories(signal?: AbortSignal): Promise<ProductCategory[]> {
  const response = await fetch('/api/vendas/categorias', {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível listar as categorias.';
    throw new Error(message);
  }

  return Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: unknown[] }).data as ProductCategory[])
    : [];
}

export async function getProduct(id: string): Promise<ProductListItem> {
  const response = await fetch(`/api/vendas/produtos/${id}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Produto não encontrado.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao buscar produto.');
  return normalizeProduct(data);
}

export async function createCategory(name: string): Promise<ProductCategory> {
  const response = await fetch('/api/vendas/categorias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível criar a categoria.';
    throw new Error(message);
  }

  const data = (json as { data?: ProductCategory } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao criar categoria.');
  return data;
}
