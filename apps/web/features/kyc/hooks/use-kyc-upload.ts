import { useCallback, useState } from 'react';
import { UPLOAD_MAX_SIZE_MB } from '../constants';
import { isValidKycGroupId } from '../utils/group-id';

export class ExternalVerificationRequiredError extends Error {
  readonly code = 'EXTERNAL_REQUIRED' as const;
  readonly groupId: string;

  constructor(params: { groupId: string; message?: string }) {
    super(params.message ?? 'Este envio deve ser feito pelo fluxo externo.');
    this.name = 'ExternalVerificationRequiredError';
    this.groupId = params.groupId;
  }
}

export class ProviderPortalRequiredError extends Error {
  readonly code = 'PROVIDER_PORTAL_REQUIRED' as const;
  readonly groupId: string;

  constructor(params: { groupId: string; message?: string }) {
    super(
      params.message ?? 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
    );
    this.name = 'ProviderPortalRequiredError';
    this.groupId = params.groupId;
  }
}

export class KycUploadApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'KycUploadApiError';
    this.code = code;
  }
}

export async function uploadDocument(groupId: string, file: File, type?: string, slotId?: string): Promise<void> {
  if (!isValidKycGroupId(groupId)) {
    throw new Error('Grupo de documento inválido. Atualize a página e tente novamente.');
  }

  // Quando há slotId, trata como atualização do arquivo existente.
  if (slotId) {
    const formData = new FormData();
    formData.set('documentFile', file);

    const res = await fetch(`/api/kyc/documents/files/${encodeURIComponent(slotId)}`, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' },
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (json?.code as string) ?? undefined;
      if (code) throw new KycUploadApiError(code, json?.message ?? 'Erro ao atualizar documento');
      throw new Error(json?.message ?? json?.error ?? 'Erro ao atualizar documento');
    }

    return;
  }

  const formData = new FormData();
  formData.set('documentFile', file);
  if (type) formData.set('type', type);

  const res = await fetch(`/api/kyc/documents/${groupId}/upload`, {
    method: 'POST',
    body: formData,
    headers: { Accept: 'application/json' },
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.code as string | undefined;
    if (res.status === 409 && code === 'EXTERNAL_REQUIRED') {
      throw new ExternalVerificationRequiredError({ groupId, message: json?.message });
    }
    if (res.status === 409 && code === 'PROVIDER_PORTAL_REQUIRED') {
      throw new ProviderPortalRequiredError({ groupId, message: json?.message });
    }
    if (code) throw new KycUploadApiError(code, json?.message ?? 'Erro ao enviar documento');
    throw new Error(json?.message ?? json?.error ?? 'Erro ao enviar documento');
  }
}

type UseKycUploadResult = {
  upload: (groupId: string, file: File, type?: string, slotId?: string) => Promise<void>;
  uploading: boolean;
  error: string | null;
  clearError: () => void;
};

export function useKycUpload(): UseKycUploadResult {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (groupId: string, file: File, type?: string, slotId?: string) => {
    if (file.size > UPLOAD_MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`Arquivo muito grande. Máximo: ${UPLOAD_MAX_SIZE_MB}MB`);
    }

    setUploading(true);
    setError(null);
    try {
      await uploadDocument(groupId, file, type, slotId);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { upload, uploading, error, clearError };
}
