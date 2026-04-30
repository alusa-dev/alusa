export interface ProductOptionValueDTO {
  id: string;
  optionId: string;
  value: string;
  sortOrder: number;
}

export interface ProductOptionDTO {
  id: string;
  productId: string;
  name: string;
  sortOrder: number;
  values: ProductOptionValueDTO[];
}

export interface ProductVariantDTO {
  id: string;
  productId: string;
  title: string;
  sku: string | null;
  price: number | null;
  stock: number;
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
  lowStockThreshold: number;
  averageCost: number;
  inventoryValue: number;
  imageUrl: string | null;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
  options: {
    variantId: string;
    optionValueId: string;
    optionValue: { id: string; value: string; option: { name: string } };
  }[];
}

// ---------- Options ----------

export async function listProductOptions(productId: string): Promise<ProductOptionDTO[]> {
  const res = await fetch(`/api/vendas/produtos/${productId}/opcoes`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return ((json as { data?: unknown[] })?.data ?? []) as ProductOptionDTO[];
}

export async function createProductOption(
  productId: string,
  name: string,
): Promise<ProductOptionDTO> {
  const res = await fetch(`/api/vendas/produtos/${productId}/opcoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return (json as { data: ProductOptionDTO }).data;
}

export async function deleteProductOption(productId: string, optionId: string): Promise<void> {
  const res = await fetch(`/api/vendas/produtos/${productId}/opcoes/${optionId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  }
}

export async function addOptionValue(
  productId: string,
  optionId: string,
  value: string,
): Promise<ProductOptionValueDTO> {
  const res = await fetch(`/api/vendas/produtos/${productId}/opcoes/${optionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return (json as { data: ProductOptionValueDTO }).data;
}

export async function deleteOptionValue(
  productId: string,
  optionId: string,
  valueId: string,
): Promise<void> {
  const res = await fetch(
    `/api/vendas/produtos/${productId}/opcoes/${optionId}/valores/${valueId}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  }
}

// ---------- Variants ----------

export async function listProductVariants(productId: string): Promise<ProductVariantDTO[]> {
  const res = await fetch(`/api/vendas/produtos/${productId}/variantes`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return ((json as { data?: unknown[] })?.data ?? []) as ProductVariantDTO[];
}

export async function generateProductVariants(productId: string): Promise<ProductVariantDTO[]> {
  const res = await fetch(`/api/vendas/produtos/${productId}/variantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'gerar' }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return ((json as { data?: unknown[] })?.data ?? []) as ProductVariantDTO[];
}

export async function updateProductVariant(
  productId: string,
  variantId: string,
  data: {
    sku?: string | null;
    price?: number | null;
    averageCost?: number;
    lowStockThreshold?: number;
    isActive?: boolean;
  },
): Promise<ProductVariantDTO> {
  const res = await fetch(`/api/vendas/produtos/${productId}/variantes/${variantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return (json as { data: ProductVariantDTO }).data;
}

export async function deleteProductVariant(productId: string, variantId: string): Promise<void> {
  const res = await fetch(`/api/vendas/produtos/${productId}/variantes/${variantId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  }
}
