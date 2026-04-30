/**
 * Utilitários de cache KYC v2.
 *
 * Centraliza a construção do payload de cache para que
 * getKycSnapshot e account-webhook-handler persistam o mesmo formato.
 *
 * Regra: onboardingUrl NUNCA é persistida em claro; apenas hasOnboardingUrl (boolean).
 */

import type {
  AsaasMyAccountDocumentsResponse,
  AsaasMyAccountDocumentGroup,
  AsaasMyAccountStatus,
} from '@alusa/asaas';
import { isAsaasInterfaceOnlyDescription } from '../../dtos/kyc/kyc-snapshot.dto';
import type { CommercialInfoExpiration, CommercialInfoStatus } from '../../dtos/kyc/kyc-snapshot.dto';

/** Normaliza rejectReasons (string | string[] | null → string[]). */
export function normalizeRejectReasons(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function normalizeScheduledDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveCommercialInfoState(params: {
  myAccountStatus?: AsaasMyAccountStatus | null;
  persistedStatus?: CommercialInfoStatus | null;
  persistedScheduledDate?: string | null;
}): {
  commercialInfoStatus: CommercialInfoStatus | null;
  commercialInfoScheduledDate: string | null;
  commercialInfoExpiration: CommercialInfoExpiration | null;
} {
  const expiration = params.myAccountStatus?.commercialInfoExpiration;

  if (expiration && typeof expiration === 'object') {
    const scheduledDate = normalizeScheduledDate(expiration.scheduledDate) ?? normalizeScheduledDate(params.persistedScheduledDate);

    if (expiration.isExpired === true) {
      return {
        commercialInfoStatus: 'EXPIRED',
        commercialInfoScheduledDate: scheduledDate,
        commercialInfoExpiration: { isExpired: true, scheduledDate },
      };
    }

    if (scheduledDate) {
      return {
        commercialInfoStatus: 'EXPIRING_SOON',
        commercialInfoScheduledDate: scheduledDate,
        commercialInfoExpiration: { isExpired: false, scheduledDate },
      };
    }

    return {
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      commercialInfoExpiration: { isExpired: false, scheduledDate: null },
    };
  }

  const persistedStatus = params.persistedStatus ?? null;
  const persistedScheduledDate = normalizeScheduledDate(params.persistedScheduledDate);

  if (persistedStatus === 'EXPIRED') {
    return {
      commercialInfoStatus: 'EXPIRED',
      commercialInfoScheduledDate: persistedScheduledDate,
      commercialInfoExpiration: { isExpired: true, scheduledDate: persistedScheduledDate },
    };
  }

  if (persistedStatus === 'EXPIRING_SOON') {
    return {
      commercialInfoStatus: 'EXPIRING_SOON',
      commercialInfoScheduledDate: persistedScheduledDate,
      commercialInfoExpiration: { isExpired: false, scheduledDate: persistedScheduledDate },
    };
  }

  return {
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
    commercialInfoExpiration: null,
  };
}

export type CachedResponsible = {
  name?: string;
  type?: string;
};

export type CachedGroupMeta = {
  id: string;
  status: string;
  type?: string;
  title?: string;
  description?: string;
  hasOnboardingUrl: boolean;
  /** true quando o grupo pertence a subconta padrão (não-BaaS) e upload via API não é aceito. */
  isAsaasInterfaceOnly?: boolean;
  responsible?: CachedResponsible | null;
  documents?: { id: string; status: string; type?: string }[];
};

export type KycSnapshotCacheV2 = {
  version: 2;
  myAccountStatus: AsaasMyAccountStatus | null;
  groups: CachedGroupMeta[];
  rejectReasons: string[];
  fetchedAt: string;
};

export function isCacheV2(value: unknown): value is KycSnapshotCacheV2 {
  if (!value || typeof value !== 'object') return false;
  return (value as { version?: unknown }).version === 2;
}

export function buildCacheV2(params: {
  myAccountStatus: AsaasMyAccountStatus | null;
  documents: AsaasMyAccountDocumentsResponse;
  fetchedAt: string;
}): KycSnapshotCacheV2 {
  return {
    version: 2,
    myAccountStatus: params.myAccountStatus,
    groups: params.documents.data.map((g) => {
      const responsibleType = (() => {
        const raw = g.responsible?.type;
        if (typeof raw === 'string') return raw;
        if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string').join(',') || undefined;
        return undefined;
      })();
      return {
        id: g.id,
        status: g.status,
        type: g.type ?? undefined,
        title: g.title ?? undefined,
        description: g.description ?? undefined,
        hasOnboardingUrl: Boolean(g.onboardingUrl),
        isAsaasInterfaceOnly: isAsaasInterfaceOnlyDescription(g.description),
        responsible: g.responsible
          ? { name: g.responsible.name, type: responsibleType }
          : null,
        documents: g.documents?.map((d) => ({
          id: d.id,
          status: d.status as string,
          type: d.type ?? undefined,
        })),
      };
    }),
    rejectReasons: normalizeRejectReasons(params.documents.rejectReasons),
    fetchedAt: params.fetchedAt,
  };
}

/**
 * Atalho para uso no webhook handler (gera fetchedAt automaticamente).
 */
export function buildWebhookCacheV2(params: {
  myAccountStatus: AsaasMyAccountStatus | null;
  documents: AsaasMyAccountDocumentsResponse;
}): KycSnapshotCacheV2 {
  return buildCacheV2({
    ...params,
    fetchedAt: new Date().toISOString(),
  });
}

export function expandCacheV2Documents(cache: KycSnapshotCacheV2): AsaasMyAccountDocumentsResponse {
  const data: AsaasMyAccountDocumentGroup[] = cache.groups.map((group) => ({
    id: group.id,
    status: group.status,
    type: group.type,
    title: group.title,
    description: group.description,
    documents: group.documents?.map((doc) => ({
      id: doc.id,
      status: doc.status,
      type: doc.type,
    })),
    responsible: group.responsible
      ? {
          name: group.responsible.name,
          type: group.responsible.type,
        }
      : undefined,
  }));

  return {
    data,
    rejectReasons: cache.rejectReasons,
  };
}
