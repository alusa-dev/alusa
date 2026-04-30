import { getMyAccountDocumentFile, type MyAccountDocumentFileResponse } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { getMyAccountDocumentsCached } from './kyc-asaas-read-cache';

export interface ViewKycDocumentFileParams {
  contaId: string;
  fileId: string;
}

export async function viewKycDocumentFile(params: ViewKycDocumentFileParams): Promise<MyAccountDocumentFileResponse> {
  const creds = await loadAsaasCredentials(params.contaId);
  if (!creds) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  // Read-before-read: garantir que o arquivo pertence à conta
  const docs = await getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true });
  const belongsToAccount = docs.data.some((g) => (g.documents ?? []).some((d) => d.id === params.fileId));
  if (!belongsToAccount) {
    throw new Error('Arquivo de documento não encontrado para esta conta');
  }

  return getMyAccountDocumentFile({
    apiKey: creds.apiKey,
    documentId: params.fileId,
  });
}
