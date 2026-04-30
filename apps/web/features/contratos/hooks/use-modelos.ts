'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import {
  getContratoModelos,
  createContratoModelo,
  updateContratoModelo,
  deleteContratoModelo,
  type ContratoModelo,
  type CreateContratoModeloPayload,
  type UpdateContratoModeloPayload,
} from '../services/modelos-service';

interface UseModelosOptions {
  activeOnly?: boolean;
  autoLoad?: boolean;
}

export function useModelos(options: UseModelosOptions = {}) {
  const { activeOnly = false, autoLoad = true } = options;
  const [modelos, setModelos] = useState<ContratoModelo[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getContratoModelos(activeOnly);
      setModelos(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar modelos';
      setError(message);
      console.error('[useModelos] Erro:', err);
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  const create = useCallback(
    async (payload: CreateContratoModeloPayload): Promise<ContratoModelo | null> => {
      try {
        const modelo = await createContratoModelo(payload);
        setModelos((prev) => [modelo, ...prev]);
        toast.success('Modelo de contrato criado');
        return modelo;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao criar modelo';
        toast.error(message);
        return null;
      }
    },
    []
  );

  const update = useCallback(
    async (id: string, payload: UpdateContratoModeloPayload): Promise<boolean> => {
      try {
        const updated = await updateContratoModelo(id, payload);
        setModelos((prev) =>
          prev.map((m) => (m.id === id ? { ...m, ...updated } : m))
        );
        toast.success('Modelo atualizado');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro ao atualizar';
        toast.error(message);
        return false;
      }
    },
    []
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteContratoModelo(id);
      setModelos((prev) => prev.filter((m) => m.id !== id));
      toast.success('Modelo removido');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover';
      toast.error(message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (autoLoad) {
      load();
    }
  }, [autoLoad, load]);

  return {
    modelos,
    loading,
    error,
    reload: load,
    create,
    update,
    remove,
  };
}
