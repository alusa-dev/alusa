
import { useState, useCallback, useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import {
  getContratos,
  createContrato as createContratoService,
  cancelContrato as cancelContratoService,
  type Contrato,
} from '../services/contratos-service';

interface UseContratosOptions {
  matriculaId?: string;
}

export function useContratos({ matriculaId }: UseContratosOptions = {}) {
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContratos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getContratos(matriculaId);
      setContratos(data);
    } catch (err) {
      setError((err as Error).message);
      toast.error('Erro ao carregar contratos');
    } finally {
      setLoading(false);
    }
  }, [matriculaId]);

  useEffect(() => {
    loadContratos();
  }, [loadContratos]);

  const createContrato = useCallback(async (modeloId: string, customMatriculaId?: string) => {
    try {
      const targetMatricula = customMatriculaId || matriculaId;
      if (!targetMatricula) throw new Error('Matrícula não informada');
      
      await createContratoService({ matriculaId: targetMatricula, modeloId });
      toast.success('Contrato gerado com sucesso');
      loadContratos();
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  }, [matriculaId, loadContratos]);

  const cancelContrato = useCallback(async (id: string) => {
    try {
      await cancelContratoService(id);
      toast.success('Contrato cancelado com sucesso');
      setContratos((prev) => 
        prev.map(c => c.id === id ? { ...c, status: 'CANCELADO' } : c)
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  return {
    contratos,
    loading,
    error,
    reload: loadContratos,
    createContrato,
    cancelContrato,
  };
}
