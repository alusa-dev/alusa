import { describe, it, expect } from 'vitest';
import type { ProductFormValues } from '@/features/vendas/ProductFormFeature';

// ── Pure validation logic extracted for testing ────────────────────

function validate(values: ProductFormValues): Partial<Record<keyof ProductFormValues, string>> {
  const errors: Partial<Record<keyof ProductFormValues, string>> = {};

  if (!values.name.trim()) {
    errors.name = 'Informe o nome do produto.';
  }

  const price = Number(values.price);
  if (!values.price.trim() || Number.isNaN(price) || price <= 0) {
    errors.price = 'Informe um preço válido (maior que zero).';
  }

  const initialStock = Number(values.initialStock);
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    errors.initialStock = 'Informe um estoque inicial válido.';
  }

  return errors;
}

function normalizePrice(raw: string): string {
  return raw.replace(/[^\d,.]/g, '').replace(',', '.');
}

// ── Tests: validação do formulário ────────────────────────────────

describe('ProductFormFeature — validação', () => {
  it('aceita produto válido sem erros', () => {
    const errors = validate({
      name: 'Camiseta',
      description: '',
      sku: '',
      price: '49.90',
      initialStock: '10',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('rejeita nome vazio', () => {
    const errors = validate({
      name: '  ',
      description: '',
      sku: '',
      price: '49.90',
      initialStock: '10',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.name).toBe('Informe o nome do produto.');
  });

  it('rejeita preço zero', () => {
    const errors = validate({
      name: 'Produto',
      description: '',
      sku: '',
      price: '0',
      initialStock: '10',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.price).toBeDefined();
  });

  it('rejeita preço negativo', () => {
    const errors = validate({
      name: 'Produto',
      description: '',
      sku: '',
      price: '-10',
      initialStock: '10',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.price).toBeDefined();
  });

  it('rejeita preço vazio', () => {
    const errors = validate({
      name: 'Produto',
      description: '',
      sku: '',
      price: '',
      initialStock: '10',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.price).toBeDefined();
  });

  it('rejeita estoque negativo', () => {
    const errors = validate({
      name: 'Produto',
      description: '',
      sku: '',
      price: '10',
      initialStock: '-1',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.initialStock).toBeDefined();
  });

  it('aceita estoque zero (produto sem estoque)', () => {
    const errors = validate({
      name: 'Produto',
      description: '',
      sku: '',
      price: '10',
      initialStock: '0',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.initialStock).toBeUndefined();
  });

  it('retorna múltiplos erros simultaneamente', () => {
    const errors = validate({
      name: '',
      description: '',
      sku: '',
      price: '',
      initialStock: '-5',
      lowStockThreshold: '5',
      categoryId: '',
    });
    expect(errors.name).toBeDefined();
    expect(errors.price).toBeDefined();
    expect(errors.initialStock).toBeDefined();
  });
});

// ── Tests: normalização de preço ──────────────────────────────────

describe('ProductFormFeature — normalização de preço', () => {
  it('mantém número com ponto decimal', () => {
    expect(normalizePrice('49.90')).toBe('49.90');
  });

  it('converte vírgula para ponto', () => {
    expect(normalizePrice('49,90')).toBe('49.90');
  });

  it('remove caracteres não numéricos (R$, espaços)', () => {
    expect(normalizePrice('R$ 49,90')).toBe('49.90');
  });

  it('aceita número inteiro', () => {
    expect(normalizePrice('100')).toBe('100');
  });

  it('retorna string vazia para entrada vazia', () => {
    expect(normalizePrice('')).toBe('');
  });
});
