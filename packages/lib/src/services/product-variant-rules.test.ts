import { describe, expect, it } from 'vitest';

import { formatProductVariantTitle, resolveProductSalePrice } from './product-variant-rules';

describe('product variant rules', () => {
  it('uses the product price only for a product without variants', () => {
    expect(
      resolveProductSalePrice({
        hasVariants: false,
        productPrice: 55,
      }),
    ).toBe(55);
  });

  it('does not fall back to the product price when a variant has no price', () => {
    expect(
      resolveProductSalePrice({
        hasVariants: true,
        productPrice: 55,
        variantId: 'variant-rosa-30',
        variantPrice: null,
      }),
    ).toBeNull();
  });

  it('uses the price explicitly configured for a variant', () => {
    expect(
      resolveProductSalePrice({
        hasVariants: true,
        productPrice: 55,
        variantId: 'variant-rosa-30',
        variantPrice: 62,
      }),
    ).toBe(62);
  });

  it('uses option links to restore missing legacy attributes in titles', () => {
    expect(
      formatProductVariantTitle(
        [{ name: 'Rosa', value: 'Número 30' }],
        'Número 30',
      ),
    ).toBe('Rosa · Número 30');
  });
});
