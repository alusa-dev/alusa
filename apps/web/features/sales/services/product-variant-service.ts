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

export interface VariantAttributeEntry {
  name: string;
  value: string;
}

export interface ProductVariantGroup {
  key: string;
  optionName: string;
  value: string;
  isLegacyCombination: boolean;
  variants: ProductVariantDTO[];
  onHand: number;
  reserved: number;
  available: number;
  incoming: number;
  averageCost: number;
}

export function needsVariantGeneration(
  options: ProductOptionDTO[],
  variants: Pick<ProductVariantDTO, 'options'>[],
): boolean {
  if (options.length === 0) return false;

  const expectedValueIds = new Set(
    options.flatMap((option) => option.values.map((value) => value.id)),
  );
  const linkedValueIds = new Set<string>();
  const hasLegacyCombination = variants.some((variant) => {
    if (variant.options.length !== 1) return true;
    const optionValueId = variant.options[0]?.optionValueId;
    if (optionValueId) linkedValueIds.add(optionValueId);
    return false;
  });

  return (
    hasLegacyCombination ||
    expectedValueIds.size !== linkedValueIds.size ||
    [...expectedValueIds].some((valueId) => !linkedValueIds.has(valueId)) ||
    [...linkedValueIds].some((valueId) => !expectedValueIds.has(valueId))
  );
}

/**
 * Returns the attribute/value pairs that identify a sellable variant.
 * The persisted `title` is kept as a fallback for legacy variants that do
 * not have option links available.
 */
export function getVariantAttributeEntries(
  variant: Pick<ProductVariantDTO, 'options'>,
  optionOrder: string[] = [],
): VariantAttributeEntry[] {
  const order = new Map(optionOrder.map((name, index) => [name, index]));

  return variant.options
    .map((item) => ({
      name: item.optionValue.option.name,
      value: item.optionValue.value,
    }))
    .sort((left, right) => {
      const leftIndex = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
}

export function formatVariantLabel(
  variant: Pick<ProductVariantDTO, 'title' | 'options'>,
  optionOrder: string[] = [],
): string {
  const attributes = getVariantAttributeEntries(variant, optionOrder);
  return attributes.length > 0
    ? attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(' · ')
    : variant.title;
}

export function formatVariantDisplayName(
  variant: Pick<ProductVariantDTO, 'title' | 'options'>,
  productName?: string,
  optionOrder: string[] = [],
): string {
  const attributes = getVariantAttributeEntries(variant, optionOrder);
  const values = attributes.length > 0
    ? attributes.flatMap((attribute) => [attribute.name, attribute.value])
    : [variant.title];
  return [productName?.trim(), ...values].filter(Boolean).join(' · ');
}

export function groupProductVariants(
  variants: ProductVariantDTO[],
  optionOrder: string[] = [],
): ProductVariantGroup[] {
  const groups = new Map<string, ProductVariantGroup>();

  for (const variant of variants) {
    const isLegacyCombination = variant.options.length !== 1;
    const primaryOption = variant.options[0];
    const optionName = primaryOption?.optionValue.option.name ?? '';
    const key = isLegacyCombination
      ? 'legacy-combinations'
      : optionName || `variant:${variant.id}`;
    const value = isLegacyCombination ? 'Combinações antigas' : optionName || variant.title;
    const current = groups.get(key);

    if (current) {
      current.variants.push(variant);
      current.onHand += variant.onHand;
      current.reserved += variant.reserved;
      current.available += variant.available;
      current.incoming += variant.incoming;
      continue;
    }

    groups.set(key, {
      key,
      optionName,
      value,
      isLegacyCombination,
      variants: [variant],
      onHand: variant.onHand,
      reserved: variant.reserved,
      available: variant.available,
      incoming: variant.incoming,
      averageCost: 0,
    });
  }

  return [...groups.values()]
    .sort((left, right) => {
      const leftIndex = optionOrder.indexOf(left.value);
      const rightIndex = optionOrder.indexOf(right.value);
      return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    })
    .map((group) => {
      const weightedCost = group.variants.reduce(
        (total, variant) => total + variant.onHand * variant.averageCost,
        0,
      );
      const averageFallback = group.variants.reduce(
        (total, variant) => total + variant.averageCost,
        0,
      );

      return {
        ...group,
        averageCost:
          group.onHand > 0
            ? Number((weightedCost / group.onHand).toFixed(4))
            : Number((averageFallback / group.variants.length).toFixed(4)),
      };
    });
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

export async function bulkUpdateProductVariants(
  productId: string,
  variantIds: string[],
  data: { price: number; averageCost: number },
): Promise<ProductVariantDTO[]> {
  const res = await fetch(`/api/vendas/produtos/${productId}/variantes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'precificar-massa', variantIds, ...data }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro');
  return (json as { data: ProductVariantDTO[] }).data;
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
