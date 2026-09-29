import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listProducts,
  archiveProduct,
  deleteProduct,
  restoreProduct,
  toggleProductActive,
  listCategories,
  type ProductListItem,
  type ProductCategory,
  type ListProductsParams,
} from '../services/products-service';

export interface UseProductsFilters {
  search?: string;
  categoryId?: string;
  archived?: boolean;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function useProducts() {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ page: 1, pageSize: 50, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (filters?: UseProductsFilters) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await listProducts({
        q: filters?.search,
        categoryId: filters?.categoryId,
        archived: filters?.archived,
        activeOnly: filters?.activeOnly,
        page: filters?.page,
        pageSize: filters?.pageSize,
        signal: controller.signal,
      });
      setItems(result.data);
      setMeta(result.meta);
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setItems([]);
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await listCategories();
      setCategories(cats);
    } catch {
      // silently fail - categories are optional
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCategories();
    return () => abortRef.current?.abort();
  }, [load, loadCategories]);

  const remove = useCallback(async (id: string) => {
    await archiveProduct(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
    setMeta((prev) => ({ ...prev, total: prev.total - 1 }));
  }, []);

  const destroy = useCallback(async (id: string) => {
    await deleteProduct(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
    setMeta((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
  }, []);

  const restore = useCallback(async (id: string) => {
    const updated = await restoreProduct(id);
    setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }, []);

  const toggleActive = useCallback(async (id: string, isActive: boolean) => {
    const updated = await toggleProductActive(id, isActive);
    setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }, []);

  return {
    items,
    categories,
    loading,
    error,
    meta,
    reload: load,
    reloadCategories: loadCategories,
    remove,
    destroy,
    restore,
    toggleActive,
    setItems,
  };
}

export type UseProductsReturn = ReturnType<typeof useProducts>;
