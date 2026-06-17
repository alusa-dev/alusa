'use client';

import { useCallback, useState } from 'react';

import type { FiscalCodeKind } from '@alusa/finance/fiscal-wizard-client';

import type { FiscalSettingsResponseDTO, SaveFiscalSettingsInputDTO } from '../dtos';
import { normalizeNbsCodeForAsaas } from '@alusa/finance/fiscal-wizard-client';
import { FiscalSettingsSaveError } from './fiscal-settings-save-error';

function buildFiscalReferenceSearchParams(kind: FiscalCodeKind, query?: string) {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (!query?.trim()) return params;

  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, '');
  const looksLikeCode = digits.length >= 2 && digits.length / trimmed.length >= 0.5;
  if (looksLikeCode) {
    params.set('code', digits);
  } else {
    params.set('description', trimmed);
  }
  return params;
}

export type { FiscalSettingsSaveError };
export type SaveFiscalSettingsPayload = SaveFiscalSettingsInputDTO & {
  certificateFile?: File;
};

function appendIfPresent(formData: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  if (value instanceof File) {
    formData.append(key, value);
    return;
  }
  formData.append(key, String(value));
}

function buildFiscalSaveRequest(payload: SaveFiscalSettingsPayload) {
  const normalizedPayload: SaveFiscalSettingsPayload = {
    ...payload,
    nbsCode: normalizeNbsCodeForAsaas(payload.nbsCode),
  };
  const hasFile = Boolean(normalizedPayload.certificateFile);
  const body = hasFile
    ? (() => {
        const formData = new FormData();
        Object.entries(normalizedPayload).forEach(([key, value]) =>
          appendIfPresent(formData, key, value),
        );
        return formData;
      })()
    : JSON.stringify(normalizedPayload);
  return {
    body,
    headers: hasFile ? undefined : ({ 'Content-Type': 'application/json' } as const),
  };
}

function parseFiscalSaveError(json: Record<string, unknown>, fallbackMessage: string) {
  return new FiscalSettingsSaveError({
    code: typeof json.error === 'string' ? json.error : 'ERRO_AO_SALVAR',
    message:
      typeof json.message === 'string'
        ? json.message
        : typeof json.error === 'string'
          ? json.error
          : fallbackMessage,
    step: typeof json.step === 'string' ? json.step : undefined,
    details: Array.isArray(json.details)
      ? json.details.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    issues: Array.isArray(json.issues) ? json.issues : [],
  });
}

export function useFiscalInvoiceSettings() {
  const [data, setData] = useState<FiscalSettingsResponseDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCore, setSavingCore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracoes/notafiscal', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar configuração fiscal');
      setData(json.data);
      return json.data as FiscalSettingsResponseDTO;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
      return null;
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (payload: SaveFiscalSettingsPayload) => {
    setSaving(true);
    setError(null);
    const { body, headers } = buildFiscalSaveRequest(payload);
    try {
      const res = await fetch('/api/configuracoes/notafiscal', {
        method: 'PUT',
        headers,
        body,
      });
      const json = await res.json();
      if (!res.ok) {
        throw parseFiscalSaveError(json, 'Erro ao salvar configuração fiscal');
      }
      if (json.data?.settings) setData(json.data);
      return json.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
      throw e;
    } finally {
      setSaving(false);
    }
  }, []);

  const saveCoreSettings = useCallback(async (payload: SaveFiscalSettingsPayload) => {
    setSavingCore(true);
    setError(null);
    const { body, headers } = buildFiscalSaveRequest(payload);
    try {
      const res = await fetch('/api/configuracoes/notafiscal/nucleo', {
        method: 'PUT',
        headers,
        body,
      });
      const json = await res.json();
      if (!res.ok) {
        throw parseFiscalSaveError(json, 'Erro ao salvar informações fiscais');
      }
      if (json.data?.settings) setData(json.data);
      return json.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
      throw e;
    } finally {
      setSavingCore(false);
    }
  }, []);

  const fetchMunicipalOptions = useCallback(async () => {
    const res = await fetch('/api/configuracoes/notafiscal/municipal-options', { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar opções municipais');
    return json.data;
  }, []);

  const fetchMunicipalServices = useCallback(async (description?: string) => {
    const params = new URLSearchParams();
    if (description?.trim()) params.set('description', description.trim());
    params.set('limit', '20');
    const res = await fetch(`/api/configuracoes/notafiscal/servicos-municipais?${params}`, {
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) {
      const message =
        typeof json.message === 'string'
          ? json.message
          : json.error === 'FISCAL_CORE_NOT_SYNCED'
            ? 'Salve emissor e informações fiscais antes de listar serviços municipais.'
            : (json.error ?? 'Erro ao carregar serviços municipais');
      throw new Error(message);
    }
    return json.data as {
      data: Array<{ id?: string; description?: string; issTax?: number }>;
      totalCount: number;
      hasMore: boolean;
      portalManualMode: boolean;
    };
  }, []);

  const deleteService = useCallback(async (serviceId: string) => {
    const res = await fetch(`/api/configuracoes/notafiscal/servicos/${serviceId}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof json.error === 'string' ? json.error : 'Erro ao excluir serviço municipal',
      );
    }
    return json.data as { id: string };
  }, []);

  const syncSettings = useCallback(async () => {
    const res = await fetch('/api/configuracoes/notafiscal/sincronizar', {
      method: 'POST',
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof json.error === 'string' ? json.error : 'Erro ao sincronizar configuração fiscal',
      );
    }
    await fetchSettings({ silent: true });
    return json.data as {
      syncedAt: string;
      readiness?: FiscalSettingsResponseDTO['readiness'];
      remote?: { useNationalPortal: boolean | null; fiscalEmail: string | null };
    };
  }, [fetchSettings]);

  const configureNationalPortal = useCallback(async (enabled: boolean) => {
    const res = await fetch('/api/configuracoes/notafiscal/portal-nacional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        typeof json.error === 'string'
          ? json.error
          : 'Erro ao configurar Portal Nacional',
      );
    }
    await fetchSettings({ silent: true });
    return json.data as { success: boolean; useNationalPortal: boolean };
  }, [fetchSettings]);

  const fetchNbsCodes = useCallback(async (codeDescription?: string) => {
    const params = new URLSearchParams();
    if (codeDescription?.trim()) params.set('codeDescription', codeDescription.trim());
    params.set('limit', '20');
    const res = await fetch(`/api/configuracoes/notafiscal/nbs-codes?${params}`, {
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar códigos NBS');
    return json.data as {
      data: Array<{ nbsCode?: string; codeDescription?: string }>;
      totalCount: number;
      hasMore: boolean;
    };
  }, []);

  const fetchFiscalReferenceCodes = useCallback(
    async (kind: FiscalCodeKind, query?: string) => {
      const params = buildFiscalReferenceSearchParams(kind, query);
      const res = await fetch(`/api/configuracoes/notafiscal/referencias/${kind}?${params}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? 'Erro ao carregar códigos fiscais de referência');
      }
      return json.data as {
        data: Array<{ code?: string; description?: string }>;
        totalCount: number;
        hasMore: boolean;
      };
    },
    [],
  );

  return {
    data,
    loading,
    saving,
    savingCore,
    error,
    fetchSettings,
    saveSettings,
    saveCoreSettings,
    fetchMunicipalOptions,
    fetchMunicipalServices,
    fetchNbsCodes,
    fetchFiscalReferenceCodes,
    deleteService,
    syncSettings,
    configureNationalPortal,
    setData,
  };
}
