'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  contaFinancialPolicyResultDTOSchema,
  type ContaFinancialPolicyDTO,
  type UpdateContaFinancialPolicyInputDTO,
} from '../dtos';

export function useContaFinancialPolicy() {
  const [policy, setPolicy] = useState<ContaFinancialPolicyDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/configuracoes/politicas/financeiro', { cache: 'no-store' });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((json as { message?: string; error?: string } | null)?.message || 'Erro ao carregar a regra da rematrícula.');
      }
      const parsed = contaFinancialPolicyResultDTOSchema.parse(json);
      setPolicy(parsed.policy);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar a regra da rematrícula.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPolicy();
  }, [fetchPolicy]);

  const savePolicy = useCallback(async (input: UpdateContaFinancialPolicyInputDTO) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/configuracoes/politicas/financeiro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((json as { message?: string; error?: string } | null)?.message || 'Erro ao salvar a regra da rematrícula.');
      }
      const parsed = contaFinancialPolicyResultDTOSchema.parse(json);
      setPolicy(parsed.policy);
      return parsed.policy;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar a regra da rematrícula.';
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    policy,
    loading,
    saving,
    error,
    fetchPolicy,
    savePolicy,
  };
}
