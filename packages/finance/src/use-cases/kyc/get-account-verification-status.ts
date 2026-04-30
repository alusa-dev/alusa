/**
 * Use-case: getAccountVerificationStatus
 *
 * Endpoint BFF que mapeia o snapshot canônico de KYC para o modelo de produto.
 * O frontend consome apenas este formato — nunca vê termos do Asaas.
 *
 * Regras:
 * - Status mapeado de 8 estados internos → 5 estados de produto
 * - mode decidido pelo backend com base no payload oficial do provedor
 * - Labels vêm do Asaas (title/description) com fallback para mapa interno
 * - onboardingUrl rebatizado como redirectUrl — nunca exposto como "onboarding"
 */

import { getKycSnapshotByContaId } from './get-kyc-snapshot';
import type { GetKycSnapshotOptions } from './get-kyc-snapshot';
import {
  type AccountVerificationResponse,
  type AccountVerificationStatus,
  type VerificationAction,
  type VerificationActionStatus,
  type VerificationSlotInfo,
  type VerificationAreaInfo,
  type KycAreaStatus,
  mapProcessToAccountStatus,
} from '../../dtos/kyc/kyc-snapshot.dto';
import { deriveGroupLabel } from './kyc-label-utils';
import { ensureSubaccountEmailSynced } from '../asaas-account/ensure-subaccount-email-synced';

// ── Helpers ──────────────────────────────────────────────────────────────

function areaLabel(key: string): string {
  switch (key) {
    case 'general': return 'Aprovação geral';
    case 'documentation': return 'Documentação';
    case 'bankAccount': return 'Conta bancária';
    case 'commercialInfo': return 'Dados comerciais';
    default: return key;
  }
}

function areaDescription(status: KycAreaStatus): string {
  if (status === 'APPROVED') return 'Verificação concluída';
  if (status === 'REJECTED') return 'Requer correção';
  if (status === 'AWAITING_APPROVAL') return 'Em análise';
  if (status === 'PENDING' || status === 'NOT_SENT') return 'Pendente';
  return 'Aguardando';
}

function buildAreas(snapshot: {
  generalStatus: KycAreaStatus;
  documentationStatus: KycAreaStatus;
  bankAccountStatus: KycAreaStatus;
  commercialInfoAreaStatus: KycAreaStatus;
}): VerificationAreaInfo[] {
  const entries: Array<{ key: string; status: KycAreaStatus }> = [
    { key: 'general', status: snapshot.generalStatus },
    { key: 'documentation', status: snapshot.documentationStatus },
    { key: 'bankAccount', status: snapshot.bankAccountStatus },
    { key: 'commercialInfo', status: snapshot.commercialInfoAreaStatus },
  ];

  return entries.map(({ key, status }) => ({
    key,
    label: areaLabel(key),
    description: areaDescription(status),
    status,
  }));
}

function buildActions(
  nextActions: Array<{
    kind: string;
    groupId: string;
    groupStatus?: string;
    type: string | null;
    title: string;
    description?: string;
    onboardingUrl?: string;
    onboardingUrlExpirationDate?: string | null;
    isOnboardingUrlExpired?: boolean;
    slots?: Array<{ id: string; label: string; status: string }>;
    responsible?: { name?: string; type?: string } | null;
    submissionMethod?: 'EXTERNAL_ONBOARDING_URL' | 'INTERNAL_UPLOAD';
  }>,
): VerificationAction[] {
  return nextActions.map((action) => {
    if (
      action.kind === 'WAITING_PROVIDER'
      || action.kind === 'PROVISIONING_TIMEOUT'
      || action.kind === 'PROVIDER_PORTAL_REQUIRED'
    ) {
      const status: VerificationActionStatus = (action.groupStatus ?? '').toUpperCase() === 'REJECTED'
        ? 'REJECTED'
        : 'PENDING';

      return {
        id: action.groupId,
        label: deriveGroupLabel(action.title, action.type),
        description: action.description,
        mode: action.kind as 'WAITING_PROVIDER' | 'PROVISIONING_TIMEOUT' | 'PROVIDER_PORTAL_REQUIRED',
        status,
        documentType: action.type,
        responsible: action.responsible,
        submissionMethod: action.submissionMethod,
      };
    }

    const mode = action.kind === 'EXTERNAL_ONBOARDING' ? ('REDIRECT' as const) : ('UPLOAD' as const);

    const status: VerificationActionStatus = (action.groupStatus ?? '').toUpperCase() === 'REJECTED'
      ? 'REJECTED'
      : 'PENDING';

    const slots: VerificationSlotInfo[] | undefined = action.slots?.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
    }));

    const base: VerificationAction = {
      id: action.groupId,
      label: deriveGroupLabel(action.title, action.type),
      description: action.description,
      mode,
      status,
      documentType: action.type,
      slots,
      responsible: action.responsible,
      submissionMethod: action.submissionMethod,
    };

    if (mode === 'REDIRECT') {
      return {
        ...base,
        submissionMethod: action.submissionMethod,
        redirectUrl: action.onboardingUrl,
        redirectUrlExpirationDate: action.onboardingUrlExpirationDate ?? null,
        isRedirectExpired: action.isOnboardingUrlExpired,
      };
    }

    return {
      ...base,
      uploadGroupId: action.groupId,
      uploadType: action.type,
    };
  });
}

function assertActionsInvariants(actions: VerificationAction[]): void {
  for (const a of actions) {
    if (
      a.mode === 'WAITING_PROVIDER'
      || a.mode === 'PROVISIONING_TIMEOUT'
      || a.mode === 'PROVIDER_PORTAL_REQUIRED'
    ) continue;

    if (a.mode === 'REDIRECT') {
      if (!a.redirectUrl || typeof a.redirectUrl !== 'string' || !a.redirectUrl.trim()) {
        throw new Error('REDIRECT action sem redirectUrl');
      }
      if (a.uploadGroupId) {
        throw new Error('REDIRECT action com uploadGroupId');
      }
    }

    if (a.mode === 'UPLOAD') {
      if (!a.uploadGroupId || typeof a.uploadGroupId !== 'string' || !a.uploadGroupId.trim()) {
        throw new Error('UPLOAD action sem uploadGroupId');
      }
      if (a.redirectUrl) {
        throw new Error('UPLOAD action com redirectUrl');
      }
    }
  }
}

// ── Ponto de entrada ─────────────────────────────────────────────────────

export type GetAccountVerificationStatusResult =
  | { ready: true; data: AccountVerificationResponse }
  | { ready: false; reason: 'NOT_READY' };

export async function getAccountVerificationStatus(
  contaId: string,
  opts: GetKycSnapshotOptions = {},
): Promise<GetAccountVerificationStatusResult> {
  if (opts.fresh) {
    try {
      await ensureSubaccountEmailSynced({ contaId, actor: { type: 'SYSTEM' } });
    } catch (error) {
      try {
        console.warn('[finance.getAccountVerificationStatus] Falha ao sincronizar email da subconta', {
          contaId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // noop
      }
    }
  }

  const snapshot = await getKycSnapshotByContaId(contaId, opts);

  if (!snapshot) {
    return { ready: false, reason: 'NOT_READY' };
  }

  const status: AccountVerificationStatus = mapProcessToAccountStatus(snapshot.processStatus);

  // Guard: processo já APPROVED → nenhuma ação de upload/redirect deve ser exposta
  if (snapshot.processStatus === 'APPROVED') {
    const response: AccountVerificationResponse = {
      status,
      actions: [],
      areas: buildAreas(snapshot),
      commercialInfoStatus: snapshot.commercialInfoStatus,
      commercialInfoScheduledDate: snapshot.commercialInfoScheduledDate,
      commercialInfoExpiration: snapshot.commercialInfoExpiration,
      rejectReasons: snapshot.rejectReasons,
      fetchedAt: snapshot.fetchedAt,
      isSandbox: snapshot.isSandbox,
    };
    return { ready: true, data: response };
  }

  // Se o snapshot veio de cache, EXTERNAL_ONBOARDING pode vir sem URL.
  // Para manter determinístico (sem degradar para UPLOAD), fazemos 1 refetch fresh quando necessário.
  const hasRedirectWithoutUrl = snapshot.nextActions.some(
    (a) => a.kind === 'EXTERNAL_ONBOARDING' && !a.onboardingUrl,
  );

  const snapshotForActions = (!opts.fresh && hasRedirectWithoutUrl)
    ? await getKycSnapshotByContaId(contaId, { ...opts, fresh: true })
    : snapshot;

  if (!snapshotForActions) {
    return { ready: false, reason: 'NOT_READY' };
  }

  const actions = buildActions(snapshotForActions.nextActions);
  const areas = buildAreas(snapshot);

  // Se ainda houver REDIRECT sem URL mesmo após fresh, consideramos NOT_READY.
  const invalidRedirect = actions.some((a) => a.mode === 'REDIRECT' && !a.redirectUrl);
  if (invalidRedirect) {
    return { ready: false, reason: 'NOT_READY' };
  }

  assertActionsInvariants(actions);

  const response: AccountVerificationResponse = {
    status,
    actions,
    areas,
    commercialInfoStatus: snapshot.commercialInfoStatus,
    commercialInfoScheduledDate: snapshot.commercialInfoScheduledDate,
    commercialInfoExpiration: snapshot.commercialInfoExpiration,
    rejectReasons: snapshot.rejectReasons,
    fetchedAt: snapshot.fetchedAt,
    isSandbox: snapshot.isSandbox,
  };

  return { ready: true, data: response };
}
