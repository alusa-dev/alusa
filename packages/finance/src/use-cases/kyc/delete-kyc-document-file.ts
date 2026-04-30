import { deleteMyAccountDocumentFile } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { getMyAccountDocumentsCached } from './kyc-asaas-read-cache';
import { refreshKycReadModel } from './refresh-kyc-read-model';

export interface DeleteKycDocumentFileParams {
  contaId: string;
  fileId: string;
  actor?: { type: AuditActorType; id?: string };
}

export interface DeleteKycDocumentFileResult {
  deleted: boolean;
  id: string;
}

export async function deleteKycDocumentFile(
  params: DeleteKycDocumentFileParams,
): Promise<DeleteKycDocumentFileResult> {
  const creds = await loadAsaasCredentials(params.contaId);
  if (!creds) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  // Read-before-write: garantir que o arquivo pertence à conta antes de deletar
  const docs = await getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true });
  const found = docs.data
    .flatMap((g) => g.documents ?? [])
    .find((d) => d.id === params.fileId);

  if (!found) {
    // Idempotência: se já foi removido, repetir DELETE não deve falhar.
    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.kyc.delete_document_file',
      entity: { type: 'AsaasDocument', id: params.fileId },
      metadata: { fileId: params.fileId, deleted: true, noop: true, reason: 'ALREADY_MISSING' },
      actor: params.actor,
    });

    return { deleted: true, id: params.fileId };
  }

  if (String(found.status ?? '').toUpperCase() === 'APPROVED') {
    throw new Error('Documento já aprovado não pode ser removido.');
  }

  const result = await deleteMyAccountDocumentFile({
    apiKey: creds.apiKey,
    documentId: params.fileId,
  });

  await refreshKycReadModel(params.contaId).catch(() => {});

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.kyc.delete_document_file',
    entity: { type: 'AsaasDocument', id: params.fileId },
    metadata: { fileId: params.fileId, deleted: result.deleted },
    actor: params.actor,
  });

  return result;
}
