import { describe, expect, it } from 'vitest';

import {
  formatVariantDisplayName,
  formatVariantLabel,
  groupProductVariants,
  getVariantAttributeEntries,
  type ProductVariantDTO,
} from '@/features/vendas/services/product-variant-service';

function makeVariant(
  title: string,
  options: Array<[name: string, value: string]>,
): Pick<ProductVariantDTO, 'title' | 'options'> {
  return {
    title,
    options: options.map(([name, value]) => ({
      variantId: 'variant-1',
      optionValueId: `${name}-${value}`,
      optionValue: {
        id: `${name}-${value}`,
        value,
        option: { name },
      },
    })),
  };
}

describe('rótulo de variante', () => {
  it('exibe o nome do atributo junto com seu valor', () => {
    const variant = makeVariant('Rosa / 32', [
      ['Tamanho', '32'],
      ['Cor', 'Rosa'],
    ]);

    expect(formatVariantLabel(variant, ['Cor', 'Tamanho'])).toBe(
      'Cor: Rosa · Tamanho: 32',
    );
  });

  it('preserva o título para variantes legadas sem atributos vinculados', () => {
    const variant = makeVariant('32', []);

    expect(getVariantAttributeEntries(variant)).toEqual([]);
    expect(formatVariantLabel(variant)).toBe('32');
  });

  it('monta a identificação compacta com o produto e os valores', () => {
    const variant = makeVariant('Rosa / 32', [
      ['Rosa', '32'],
    ]);

    expect(formatVariantDisplayName(variant, 'Sapatilha')).toBe('Sapatilha · Rosa · 32');
  });

  it('agrupa variantes pelo nome do grupo e soma o estoque do grupo', () => {
    const variants = [
      Object.assign(makeVariant('Rosa · 31', [['Rosa', '31']]), {
        id: 'rosa-31',
        onHand: 4,
        reserved: 1,
        available: 3,
        incoming: 0,
        averageCost: 20,
      }),
      Object.assign(makeVariant('Rosa · 32', [['Rosa', '32']]), {
        id: 'rosa-32',
        onHand: 6,
        reserved: 0,
        available: 6,
        incoming: 2,
        averageCost: 30,
      }),
    ] as ProductVariantDTO[];

    const [group] = groupProductVariants(variants, ['Rosa', 'Preto', 'Branco']);

    expect(group.value).toBe('Rosa');
    expect(group.variants).toHaveLength(2);
    expect(group.available).toBe(9);
    expect(group.reserved).toBe(1);
    expect(group.incoming).toBe(2);
    expect(group.averageCost).toBe(26);
  });
});
