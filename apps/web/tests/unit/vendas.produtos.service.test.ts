import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getProduct,
  createProduct,
  updateProduct,
  listProducts,
} from '@/features/vendas/services/products-service';

// ── Helpers ───────────────────────────────────────────────────────

function makeProductJson(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    contaId: 'conta-1',
    name: 'Camiseta',
    description: 'Descrição da camiseta',
    sku: 'CAM-001',
    price: 49.9,
    stock: 10,
    lowStockThreshold: 5,
    categoryId: 'cat-1',
    category: { id: 'cat-1', name: 'Vestuário', contaId: 'conta-1' },
    isActive: true,
    hasVariants: false,
    archivedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 422) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests: getProduct ─────────────────────────────────────────────

describe('getProduct', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna produto normalizado para resposta 200', async () => {
    const productJson = makeProductJson();
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');

    expect(product.id).toBe('prod-1');
    expect(product.name).toBe('Camiseta');
    expect(product.price).toBe(49.9);
    expect(product.hasVariants).toBe(false);
    expect(product.category?.name).toBe('Vestuário');
  });

  it('lança erro com mensagem da API em resposta não-ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse('Produto não encontrado.', 404));

    await expect(getProduct('id-inexistente')).rejects.toThrow('Produto não encontrado.');
  });

  it('lança erro genérico quando data está ausente na resposta', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: null }));

    await expect(getProduct('prod-1')).rejects.toThrow('Resposta inválida ao buscar produto.');
  });

  it('normaliza hasVariants como true quando campo está true', async () => {
    const productJson = makeProductJson({ hasVariants: true });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');
    expect(product.hasVariants).toBe(true);
  });

  it('soma estoque de variantes ativas no totalStock', async () => {
    const productJson = makeProductJson({
      hasVariants: true,
      stock: 50,
      variants: [
        { stock: 10, lowStockThreshold: 5, isActive: true },
        { stock: 20, lowStockThreshold: 5, isActive: true },
        { stock: 999, lowStockThreshold: 5, isActive: false },
      ],
    });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');

    expect(product.totalStock).toBe(30);
  });

  it('marca stockAlertState como LOW quando alguma variante ativa está abaixo do alerta', async () => {
    const productJson = makeProductJson({
      hasVariants: true,
      variants: [
        { stock: 3, lowStockThreshold: 5, isActive: true },
        { stock: 20, lowStockThreshold: 5, isActive: true },
      ],
    });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');

    expect(product.stockAlertState).toBe('LOW');
  });

  it('normaliza hasVariants como false quando campo está ausente', async () => {
    const productJson = makeProductJson({ hasVariants: undefined });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');
    expect(product.hasVariants).toBe(false);
  });

  it('normaliza category como null quando campo está null', async () => {
    const productJson = makeProductJson({ category: null, categoryId: null });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await getProduct('prod-1');
    expect(product.category).toBeNull();
    expect(product.categoryId).toBeNull();
  });
});

// ── Tests: createProduct ──────────────────────────────────────────

describe('createProduct', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna produto criado normalizado', async () => {
    const productJson = makeProductJson({ id: 'novo-id' });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await createProduct({ name: 'Camiseta', price: 49.9 });

    expect(product.id).toBe('novo-id');
    expect(product.name).toBe('Camiseta');
  });

  it('lança erro com mensagem da API em falha', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse('Nome já está em uso.'));

    await expect(createProduct({ name: 'X', price: 10 })).rejects.toThrow('Nome já está em uso.');
  });

  it('envia método POST com payload correto', async () => {
    const productJson = makeProductJson();
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    await createProduct({ name: 'Calça', price: 89.9, initialStock: 5 });

    expect(fetch).toHaveBeenCalledWith(
      '/api/vendas/produtos',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"name":"Calça"'),
      }),
    );
  });
});

// ── Tests: updateProduct ──────────────────────────────────────────

describe('updateProduct', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna produto atualizado normalizado', async () => {
    const productJson = makeProductJson({ name: 'Camiseta Atualizada', price: 59.9 });
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    const product = await updateProduct('prod-1', { name: 'Camiseta Atualizada', price: 59.9 });

    expect(product.name).toBe('Camiseta Atualizada');
    expect(product.price).toBe(59.9);
  });

  it('lança erro com mensagem da API em falha', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse('Produto não encontrado.', 404));

    await expect(updateProduct('id-inexistente', { name: 'X' })).rejects.toThrow(
      'Produto não encontrado.',
    );
  });

  it('envia método PATCH com ID correto na URL', async () => {
    const productJson = makeProductJson();
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: productJson }));

    await updateProduct('prod-abc', { price: 99.9 });

    expect(fetch).toHaveBeenCalledWith(
      '/api/vendas/produtos/prod-abc',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

// ── Tests: listProducts ───────────────────────────────────────────

describe('listProducts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna lista e meta normalizados', async () => {
    const productJson = makeProductJson();
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({
        data: [productJson],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
    );

    const result = await listProducts();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('prod-1');
    expect(result.meta.total).toBe(1);
  });

  it('retorna lista vazia quando data está ausente', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse({ data: null, meta: null }));

    const result = await listProducts();

    expect(result.data).toHaveLength(0);
  });

  it('lança erro quando resposta não é ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse('Não autorizado.', 401));

    await expect(listProducts()).rejects.toThrow('Não autorizado.');
  });

  it('inclui parâmetro archived na URL quando passado', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
    );

    await listProducts({ archived: true });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('archived=true'),
      expect.any(Object),
    );
  });

  it('inclui parâmetro q na URL quando passado', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      okResponse({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
    );

    await listProducts({ q: 'camiseta' });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('q=camiseta'), expect.any(Object));
  });
});
