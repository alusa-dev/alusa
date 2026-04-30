import {
  updateMyAccountDocumentFile,
  type UploadMyAccountDocumentResponse,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { getMyAccountDocumentsCached } from './kyc-asaas-read-cache';
import { refreshKycReadModel } from './refresh-kyc-read-model';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface UpdateKycDocumentFileParams {
  contaId: string;
  fileId: string;
  file: { bytes: Uint8Array; filename: string; mimeType: string };
  actor?: { type: AuditActorType; id?: string };
}

export async function updateKycDocumentFile(
  params: UpdateKycDocumentFileParams,
): Promise<UploadMyAccountDocumentResponse> {
  if (params.file.bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Arquivo muito grande');
  }

  const creds = await loadAsaasCredentials(params.contaId);
  if (!creds) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  // Read-before-write: garantir que o arquivo pertence à conta antes de atualizar
  const docs = await getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true });
  const found = docs.data
    .flatMap((g) => g.documents ?? [])
    .find((d) => d.id === params.fileId);

  if (!found) {
    throw new Error('Arquivo de documento não encontrado para esta conta');
  }

  if (String(found.status ?? '').toUpperCase() === 'APPROVED') {
    throw new Error('Documento já aprovado não pode ser substituído.');
  }

  const result = await updateMyAccountDocumentFile({
    apiKey: creds.apiKey,
    documentId: params.fileId,
    documentFile: params.file,
  });

  await refreshKycReadModel(params.contaId).catch(() => {});

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.kyc.update_document_file',
    entity: { type: 'AsaasDocument', id: params.fileId },
    metadata: {
      fileId: params.fileId,
      filename: params.file.filename,
      mimeType: params.file.mimeType,
    },
    actor: params.actor,
  });

  return result;
}
