
import { useState, useCallback, useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import {
  getContracts,
  createContract as createContratoService,
  cancelContract as cancelContratoService,
  type Contract,
} from '../services/contracts-service';

interface UseContractsOptions {
  matriculaId?: string;
}

export function useContracts({ matriculaId }: UseContractsOptions = {}) {
  const [contratos, setContratos] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContratos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getContracts(matriculaId);
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

  const createContract = useCallback(async (modeloId: string, customMatriculaId?: string) => {
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

  const cancelContract = useCallback(async (id: string) => {
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
    createContract,
    cancelContract,
  };
}
