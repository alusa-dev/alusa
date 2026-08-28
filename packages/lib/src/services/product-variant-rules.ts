type MoneyValue = { toString(): string } | number | null | undefined;

export type ProductVariantAttribute = {
  name: string;
  value: string;
};

/**
 * Product variants are individually sellable items. A product price is only
 * applicable to products without variants; it must never become a fallback
 * price for a variant whose price has not been configured yet.
 */
export function resolveProductSalePrice<T extends MoneyValue>(input: {
  hasVariants: boolean;
  productPrice: T;
  variantId?: string | null;
  variantPrice?: T | null;
}): T | null {
  if (input.hasVariants || input.variantId) return input.variantPrice ?? null;
  return input.productPrice ?? null;
}

/**
 * Option links are the canonical identity of a variant. The persisted title
 * is retained only as a legacy fallback because older records may omit an
 * attribute (for example, "Número 30" instead of "Rosa · Número 30").
 */
export function formatProductVariantTitle(
  attributes: ProductVariantAttribute[],
  legacyTitle: string | null | undefined,
): string {
  if (attributes.length > 0) {
    return attributes.map(({ name, value }) => `${name} · ${value}`).join(' · ');
  }

  return legacyTitle?.trim() || 'Variante';
}
