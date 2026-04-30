/**
 * Serviço de persistência KYC.
 *
 * Responsável por sincronizar os modelos Prisma (KycProcess, KycRequirement, KycSlot)
 * com os dados do Asaas (GET /myAccount/documents + GET /myAccount/status).
 *
 * Regras:
 * - Upsert idempotente: mesmos dados do Asaas → mesmo estado no banco.
 * - onboardingUrl determina submissionMethod (EXTERNAL_ONBOARDING_URL vs INTERNAL_UPLOAD).
 * - groupId é chave de dedup para requirements; slotId para slots.
 * - Status do KycProcess é derivado do generalStatus + documentationStatus.
 */

import { prisma } from '@alusa/database';
import type {
  AsaasMyAccountDocumentsResponse,
  AsaasMyAccountDocumentGroup,
  AsaasMyAccountStatus,
} from '@alusa/asaas';
import type {
  KycProcessStatus,
  KycSubmissionMethod,
  KycDocumentStatus,
} from '@prisma/client';

import { normalizeAreaStatus, isAreaBlocking } from '../../dtos/kyc/kyc-snapshot.dto';
import { normalizeRejectReasons } from './kyc-cache-utils';
import { deriveSlotLabel } from './kyc-label-utils';

// ── Constants ────────────────────────────────────────────────────────────

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const TERMINAL_PROCESS_STATUSES = new Set<KycProcessStatus>(['APPROVED', 'REJECTED']);

// ── Mappers ──────────────────────────────────────────────────────────────

function mapGroupStatus(raw: string | null | undefined): KycDocumentStatus {
  const upper = (raw ?? '').trim().toUpperCase();
  if (upper === 'APPROVED') return 'APPROVED';
  if (upper === 'REJECTED') return 'REJECTED';
  if (upper === 'PENDING' || upper === 'AWAITING_APPROVAL') return 'PENDING';
  if (upper === 'IGNORED') return 'IGNORED';
  return 'NOT_SENT';
}

function deriveSubmissionMethod(group: AsaasMyAccountDocumentGroup): KycSubmissionMethod {
  return group.onboardingUrl ? 'EXTERNAL_ONBOARDING_URL' : 'INTERNAL_UPLOAD';
}

export function deriveProcessStatus(
  myAccountStatus: AsaasMyAccountStatus | null,
  groups: AsaasMyAccountDocumentGroup[],
): KycProcessStatus {
  if (!myAccountStatus) return 'PENDING_DOCUMENTS';

  const general = normalizeAreaStatus(myAccountStatus.general);
  const documentation = normalizeAreaStatus(myAccountStatus.documentation);

  if (general === 'APPROVED') return 'APPROVED';
  if (general === 'REJECTED' || documentation === 'REJECTED') return 'REJECTED';
  if (general === 'AWAITING_APPROVAL' || documentation === 'AWAITING_APPROVAL') return 'UNDER_REVIEW';

  const hasExternalPending = groups.some(
    (g) => g.onboardingUrl && ['NOT_SENT', 'REJECTED'].includes((g.status ?? '').toUpperCase()),
  );
  const hasInternalPending = groups.some(
    (g) => !g.onboardingUrl && ['NOT_SENT', 'REJECTED'].includes((g.status ?? '').toUpperCase()),
  );

  if (hasExternalPending) return 'EXTERNAL_IN_PROGRESS';
  if (hasInternalPending) return 'INTERNAL_UPLOADING';

  if (isAreaBlocking(documentation) || isAreaBlocking(general)) return 'PENDING_DOCUMENTS';

  return 'UNDER_REVIEW';
}

// ── Persist ──────────────────────────────────────────────────────────────

export type SyncKycModelsParams = {
  asaasAccountId: string; // PK interna do AsaasAccount (cuid)
  myAccountStatus: AsaasMyAccountStatus | null;
  documents: AsaasMyAccountDocumentsResponse;
  webhookEventId?: string;
};

/**
 * Upsert KycProcess + KycRequirement[] + KycSlot[] a partir dos dados fresh do Asaas.
 * Idempotente: se chamado múltiplas vezes com os mesmos dados, o resultado é o mesmo.
 */
export async function syncKycModels(params: SyncKycModelsParams): Promise<void> {
  const { asaasAccountId, myAccountStatus, documents, webhookEventId } = params;
  const now = new Date();

  const processStatus = deriveProcessStatus(myAccountStatus, documents.data);
  const rejectReasons = normalizeRejectReasons(documents.rejectReasons);

  // Upsert KycProcess
  const process = await prisma.kycProcess.upsert({
    where: { asaasAccountId },
    create: {
      asaasAccountId,
      status: processStatus,
      rejectReasons,
      lastWebhookEventId: webhookEventId ?? null,
      lastAsaasSyncAt: now,
    },
    update: {
      status: processStatus,
      rejectReasons,
      ...(webhookEventId ? { lastWebhookEventId: webhookEventId } : {}),
      lastAsaasSyncAt: now,
    },
    select: { id: true },
  });

  // Upsert requirements + slots
  for (const group of documents.data) {
    const responsibleName = typeof group.responsible?.name === 'string' ? group.responsible.name : null;
    const responsibleType = (() => {
      const raw = group.responsible?.type;
      if (typeof raw === 'string') return raw;
      if (Array.isArray(raw)) {
        const items = raw.filter((v): v is string => typeof v === 'string');
        return items.length ? items.join(',') : null;
      }
      return null;
    })();

    const submissionMethod = deriveSubmissionMethod(group);
    const rawGroupStatus = mapGroupStatus(group.status);

    // Invariante: em processo terminal, ZERO_UUID groups devem refletir o status do processo
    const groupStatus = (
      TERMINAL_PROCESS_STATUSES.has(processStatus) &&
      group.id === ZERO_UUID &&
      rawGroupStatus === 'NOT_SENT'
    )
      ? (processStatus === 'APPROVED' ? 'APPROVED' as KycDocumentStatus : 'REJECTED' as KycDocumentStatus)
      : rawGroupStatus;

    const requirement = await prisma.kycRequirement.upsert({
      where: {
        processId_groupId: {
          processId: process.id,
          groupId: group.id,
        },
      },
      create: {
        processId: process.id,
        groupId: group.id,
        type: group.type ?? null,
        title: group.title ?? null,
        description: group.description ?? null,
        submissionMethod,
        status: groupStatus,
        responsibleName,
        responsibleType,
      },
      update: {
        type: group.type ?? null,
        title: group.title ?? null,
        description: group.description ?? null,
        submissionMethod,
        status: groupStatus,
        responsibleName,
        responsibleType,
      },
      select: { id: true },
    });

    const slots = group.documents ?? [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const rawSlotStatus = mapGroupStatus(slot.status);
      const uiLabel = deriveSlotLabel(i, slots.length);

      // Invariante: em processo terminal, ZERO_UUID slots herdam status do processo
      const slotStatus = (
        TERMINAL_PROCESS_STATUSES.has(processStatus) &&
        slot.id === ZERO_UUID &&
        rawSlotStatus === 'NOT_SENT'
      )
        ? (processStatus === 'APPROVED' ? 'APPROVED' as KycDocumentStatus : 'REJECTED' as KycDocumentStatus)
        : rawSlotStatus;

      await prisma.kycSlot.upsert({
        where: {
          requirementId_slotId: {
            requirementId: requirement.id,
            slotId: slot.id,
          },
        },
        create: {
          requirementId: requirement.id,
          slotId: slot.id,
          status: slotStatus,
          uiLabel,
        },
        update: {
          status: slotStatus,
          uiLabel,
        },
        select: { id: true },
      });
    }
  }
}

/**
 * Atualiza apenas o status do KycProcess a partir de um evento webhook
 * (sem refetch completo dos documentos).
 */
export async function updateKycProcessStatus(params: {
  asaasAccountId: string;
  status: KycProcessStatus;
  webhookEventId?: string;
  rejectReasons?: string[];
}): Promise<void> {
  await prisma.kycProcess.upsert({
    where: { asaasAccountId: params.asaasAccountId },
    create: {
      asaasAccountId: params.asaasAccountId,
      status: params.status,
      rejectReasons: params.rejectReasons ?? [],
      lastWebhookEventId: params.webhookEventId ?? null,
      lastAsaasSyncAt: new Date(),
    },
    update: {
      status: params.status,
      ...(params.rejectReasons ? { rejectReasons: params.rejectReasons } : {}),
      ...(params.webhookEventId ? { lastWebhookEventId: params.webhookEventId } : {}),
      lastAsaasSyncAt: new Date(),
    },
    select: { id: true },
  });
}
