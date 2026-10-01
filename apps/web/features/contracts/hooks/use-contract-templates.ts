'use client';

import { useState, useCallback, useEffect } from 'react';
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';
import { toast } from '@/components/ui/toast';
import {
  getContractTemplates,
  createContractTemplate,
  updateContractTemplate,
  deleteContractTemplate,
  type ContractTemplate,
  type CreateContractTemplatePayload,
  type UpdateContractTemplatePayload,
} from '../services/contract-templates-service';

interface UseContractTemplatesOptions {
  activeOnly?: boolean;
  autoLoad?: boolean;
}

export function useContractTemplates(options: UseContractTemplatesOptions = {}) {
  const { activeOnly = false, autoLoad = true } = options;
  const [modelos, setModelos] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getContractTemplates(activeOnly);
      setModelos(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar modelos';
      setError(message);
      logClientOperationalEvent('contracts.templates.load_failed', err);
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  const create = useCallback(
    async (payload: CreateContractTemplatePayload): Promise<ContractTemplate | null> => {
      try {
        const modelo = await createContractTemplate(payload);
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
    async (id: string, payload: UpdateContractTemplatePayload): Promise<boolean> => {
      try {
        const updated = await updateContractTemplate(id, payload);
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
      await deleteContractTemplate(id);
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
