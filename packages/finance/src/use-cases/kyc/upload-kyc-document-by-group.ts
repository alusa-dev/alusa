import {
  uploadMyAccountDocument,
  type AsaasMyAccountDocumentGroup,
  type MyAccountDocumentGroupStatus,
  type MyAccountDocumentType,
} from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { AuditActorType, FinancialOnboardingStatus } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { createAsaasAccount } from '../asaas-account/create-asaas-account';
import { getKycSummary, type GetKycSummaryResult } from './get-kyc-summary';
import { DocumentsNotReadyError } from '../../errors/documents-not-ready-error';
import { OnboardingUrlRequiredError } from '../../errors/onboarding-url-required-error';
import { MissingAsaasApiKeyError } from '../../errors/missing-asaas-api-key-error';
import { getMyAccountDocumentsCached } from './kyc-asaas-read-cache';
import { InvalidKycGroupIdError } from '../../errors/invalid-kyc-group-id-error';
import { DOCUMENTS_READY_DELAY_MS, isZeroUuid } from './kyc-document-group-resolver';
import { refreshKycReadModel } from './refresh-kyc-read-model';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function canUploadToGroup(status: MyAccountDocumentGroupStatus | string): boolean {
  return status === 'NOT_SENT' || status === 'REJECTED';
}

function normalizeDocumentType(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized : null;
}

function resolveGroupDocumentTypes(group: AsaasMyAccountDocumentGroup): string[] {
  const types = new Set<string>();
  const groupType = normalizeDocumentType(group.type);
  if (groupType) types.add(groupType);

  for (const doc of group.documents ?? []) {
    const docType = normalizeDocumentType(doc.type);
    if (docType) types.add(docType);
  }

  return Array.from(types);
}

export type UploadKycDocumentByGroupResult = GetKycSummaryResult & {
  updatedOnboardingStatus: FinancialOnboardingStatus;
};

export async function uploadKycDocumentByGroup(params: {
  contaId: string;
  groupId: string;
  type?: MyAccountDocumentType | string;
  file: { bytes: Uint8Array; filename: string; mimeType: string };
  actor?: { type: AuditActorType; id?: string };
}): Promise<UploadKycDocumentByGroupResult> {
  if (params.file.bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Arquivo muito grande');
  }

  if (isZeroUuid(params.groupId)) {
    throw new InvalidKycGroupIdError(
      params.groupId,
      'Os requisitos de verificação ainda estão sendo preparados. Aguarde alguns instantes e tente novamente.',
    );
  }

  const createResult = await createAsaasAccount({ contaId: params.contaId, actor: params.actor });

  if (createResult.created) {
    throw new DocumentsNotReadyError({ retryAfterMs: DOCUMENTS_READY_DELAY_MS });
  }

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId: params.contaId } },
    select: { id: true, provisionedAt: true },
  });

  if (asaasAccount?.provisionedAt) {
    const ageMs = Date.now() - asaasAccount.provisionedAt.getTime();
    if (ageMs >= 0 && ageMs < DOCUMENTS_READY_DELAY_MS) {
      throw new DocumentsNotReadyError({ retryAfterMs: Math.max(500, DOCUMENTS_READY_DELAY_MS - ageMs) });
    }
  }

  const creds = await loadAsaasCredentials(params.contaId);
  if (!creds) {
    throw new MissingAsaasApiKeyError('Credenciais Asaas não encontradas para o tenant');
  }

  // Guard: bloquear upload se KYC já aprovado
  const kycProcess = await prisma.kycProcess.findFirst({
    where: { asaasAccount: { financeProfile: { contaId: params.contaId } } },
    select: { status: true },
  });
  if (kycProcess?.status === 'APPROVED') {
    throw new Error('Conta já verificada — envio de documentos não é permitido.');
  }

  const docs = await getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true });
  const group = docs.data.find((g) => g.id === params.groupId);
  if (!group) {
    throw new InvalidKycGroupIdError(params.groupId);
  }

  if (group.onboardingUrl) {
    throw new OnboardingUrlRequiredError({ onboardingUrl: group.onboardingUrl });
  }

  const providedType = normalizeDocumentType(params.type);
  const candidateTypes = resolveGroupDocumentTypes(group);
  const primaryType = normalizeDocumentType(group.type);
  let resolvedType: string | null = null;

  if (candidateTypes.length > 1) {
    if (providedType) {
      if (!candidateTypes.includes(providedType)) {
        throw new Error('Tipo do documento não corresponde ao solicitado.');
      }
      resolvedType = providedType;
    } else if (primaryType && candidateTypes.includes(primaryType)) {
      resolvedType = primaryType;
    } else {
      resolvedType = candidateTypes[0] ?? null;
    }
  } else if (candidateTypes.length === 1) {
    if (providedType && candidateTypes[0] !== providedType) {
      throw new Error('Tipo do documento não corresponde ao solicitado.');
    }
    resolvedType = candidateTypes[0] ?? null;
  } else if (providedType) {
    resolvedType = providedType;
  }

  if (!resolvedType) {
    throw new Error('Tipo do documento não foi informado.');
  }

  // Idempotência: se já existe envio em andamento para o mesmo tipo, não reenviar.
  const hasPendingSameType = (group.documents ?? []).some((d) => {
    const docType = normalizeDocumentType(d.type);
    const docStatus = normalizeDocumentType(d.status);
    return docType === resolvedType && docStatus === 'PENDING';
  });

  const groupStatusUpper = String(group.status ?? '').toUpperCase();
  if (hasPendingSameType && groupStatusUpper === 'PENDING') {
    const summary = await getKycSummary(params.contaId);
    return {
      ...summary,
      updatedOnboardingStatus: 'UNDER_REVIEW',
    };
  }

  if (!canUploadToGroup(group.status)) {
    if (hasPendingSameType) {
      const summary = await getKycSummary(params.contaId);
      return {
        ...summary,
        updatedOnboardingStatus: 'UNDER_REVIEW',
      };
    }
    throw new Error('Grupo não está em estado compatível para envio');
  }

  const hasApprovedSameType = (group.documents ?? []).some((d) => {
    const docType = normalizeDocumentType(d.type);
    const docStatus = normalizeDocumentType(d.status);
    return docType === resolvedType && docStatus === 'APPROVED';
  });
  if (hasApprovedSameType) {
    throw new Error('Documento já aprovado não pode ser substituído.');
  }

  const uploadResult = await uploadMyAccountDocument({
    apiKey: creds.apiKey,
    groupId: params.groupId,
    type: resolvedType as MyAccountDocumentType,
    documentFile: params.file,
  });

  // Pós-escrita: registrar fileId retornado no KycSlot para rastreabilidade
  if (uploadResult?.id && asaasAccount?.id) {
    await prisma.kycSlot.updateMany({
      where: {
        requirement: {
          process: { asaasAccountId: asaasAccount.id },
          groupId: params.groupId,
        },
        slotId: uploadResult.id,
      },
      data: {
        uploadedFileId: uploadResult.id,
        status: 'PENDING',
      },
    }).catch(() => {
      // best-effort: slot pode não existir ainda se syncKycModels não rodou
    });
  }

  await refreshKycReadModel(params.contaId).catch(() => {});

  const now = new Date();

  const [updatedAccount] = await prisma.$transaction([
    prisma.asaasAccount.updateMany({
      where: {
        financeProfile: { contaId: params.contaId },
      },
      data: {
        status: 'UNDER_REVIEW',
        statusUpdatedAt: now,
      },
    }),
    prisma.conta.update({
      where: { id: params.contaId },
      data: { financeStatus: 'FINANCE_IN_ANALYSIS' },
      select: { id: true },
    }),
  ]);

  if (updatedAccount.count === 0) {
    throw new Error('AsaasAccount não encontrado para atualização de status');
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.kyc.upload_document',
    entity: { type: 'AsaasAccount', id: params.groupId },
    metadata: {
      groupId: params.groupId,
      type: resolvedType,
      filename: params.file.filename,
      mimeType: params.file.mimeType,
    },
    actor: params.actor,
  });

  const summary = await getKycSummary(params.contaId);

  return {
    ...summary,
    updatedOnboardingStatus: 'UNDER_REVIEW',
  };
}
