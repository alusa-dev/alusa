import {
  getAsaasBaseUrlFromEnvOrThrow,
  type AsaasMyAccountDocumentsResponse,
  type AsaasMyAccountStatus,
} from '@alusa/asaas';
import { inspectAsaasCredentials, loadAsaasCredentials, prisma } from '@alusa/database';

import { getOnboardingStatus } from '../get-onboarding-status';
import { financeProfileService } from '../../foundation/finance-profile.service';
import {
  buildCacheV2,
  expandCacheV2Documents,
  isCacheV2,
  resolveCommercialInfoState,
} from './kyc-cache-utils';
import { getMyAccountDocumentsCached, getMyAccountStatusCached } from './kyc-asaas-read-cache';
import type { AsaasConnectionDTO } from '../../dtos/asaas-connection.dto';
import { getDocumentsReadiness } from './kyc-document-group-resolver';

export type GetKycSummaryResult = {
  onboarding: Awaited<ReturnType<typeof getOnboardingStatus>>;
  asaasConnection: AsaasConnectionDTO;
  myAccountStatus: AsaasMyAccountStatus | null;
  documents: AsaasMyAccountDocumentsResponse | null;
  documentsRequired: boolean;
  documentsNotReady?: boolean;
  retryAfterMs?: number;
};

const KYC_DOCUMENTS_CACHE_TTL_MS = 60_000;

function computeDocumentsRequired(documents: AsaasMyAccountDocumentsResponse | null): boolean {
  const groups = documents?.data;
  if (!Array.isArray(groups) || groups.length === 0) return false;
  return groups.some((group) => group?.status === 'NOT_SENT' || group?.status === 'REJECTED');
}

type KycDocumentsCacheLegacyV1 = {
  version: 1;
  documents: AsaasMyAccountDocumentsResponse;
  myAccountStatus?: AsaasMyAccountStatus | null;
};

function isCacheV1(value: unknown): value is KycDocumentsCacheLegacyV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as { version?: unknown; documents?: unknown };
  return v.version === 1 && Boolean(v.documents) && typeof v.documents === 'object';
}

export async function getKycSummary(contaId: string): Promise<GetKycSummaryResult> {
  return getKycSummaryInternal(contaId, { bypassCache: false });
}

export async function getKycSummaryFresh(contaId: string): Promise<GetKycSummaryResult> {
  return getKycSummaryInternal(contaId, { bypassCache: true });
}

async function getKycSummaryInternal(
  contaId: string,
  opts: {
    bypassCache: boolean;
  },
): Promise<GetKycSummaryResult> {
  const onboarding = await getOnboardingStatus(contaId);

  // 1) Fail-fast (config global): valida ASAAS_BASE_URL sem chamar o Asaas.
  try {
    getAsaasBaseUrlFromEnvOrThrow();
  } catch {
    return {
      onboarding,
      asaasConnection: { status: 'MISCONFIGURED', reasonCode: 'INVALID_BASE_URL' },
      myAccountStatus: null,
      documents: null,
      documentsRequired: false,
    };
  }

  const creds = await loadAsaasCredentials(contaId);
  if (!creds) {
    const credentialInspection = await inspectAsaasCredentials(contaId);
    return {
      onboarding,
      asaasConnection: {
        status: 'NOT_CONNECTED',
        reasonCode:
          credentialInspection.health === 'DECRYPTION_FAILED'
            ? 'CREDENTIAL_DECRYPTION_FAILED'
            : 'MISSING_CREDENTIALS',
      },
      myAccountStatus: null,
      documents: null,
      documentsRequired: false,
    };
  }

  const asaasConnection: GetKycSummaryResult['asaasConnection'] = { status: 'CONNECTED' };

  const asaasAccount = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: {
      id: true,
      asaasAccountId: true,
      provisionedAt: true,
      commercialInfoStatus: true,
      commercialInfoScheduledDate: true,
      documentsCache: true,
      documentsCacheUpdatedAt: true,
    },
  });

  const nowMs = Date.now();
  const documentsReadiness = getDocumentsReadiness(asaasAccount?.provisionedAt ?? null, nowMs);

  if (!documentsReadiness.ready) {

    // Regra 0: antes de 15s, não chamar o Asaas
    return {
      onboarding,
      asaasConnection,
      myAccountStatus: null,
      documents: null,
      documentsRequired: false,
      documentsNotReady: true,
      retryAfterMs: documentsReadiness.retryAfterMs,
    };
  }

  const ttlMs = KYC_DOCUMENTS_CACHE_TTL_MS;
  const cacheUpdatedAt = asaasAccount?.documentsCacheUpdatedAt ?? null;
  const cacheAgeMs = cacheUpdatedAt ? Date.now() - cacheUpdatedAt.getTime() : null;
  const hasCache = Boolean(asaasAccount?.documentsCache);
  const cacheHasExternalOnboarding = (() => {
    const cached = asaasAccount?.documentsCache as { version?: unknown; groups?: Array<{ hasOnboardingUrl?: unknown }> } | null;
    return cached?.version === 2 && cached.groups?.some((group) => group.hasOnboardingUrl === true) === true;
  })();
  const isCacheValid =
    !opts.bypassCache && hasCache && typeof cacheAgeMs === 'number' && cacheAgeMs >= 0 && cacheAgeMs < ttlMs;

  if (isCacheValid && !cacheHasExternalOnboarding) {
    const cached = asaasAccount?.documentsCache as unknown;

    if (isCacheV2(cached)) {
      const documents = expandCacheV2Documents(cached);
      return {
        onboarding,
        asaasConnection,
        myAccountStatus: cached.myAccountStatus ?? null,
        documents,
        documentsRequired: computeDocumentsRequired(documents),
      };
    }

    if (isCacheV1(cached)) {
      return {
        onboarding,
        asaasConnection,
        myAccountStatus: cached.myAccountStatus ?? null,
        documents: cached.documents,
        documentsRequired: computeDocumentsRequired(cached.documents),
      };
    }

    // cache legado: apenas documents
    if (cached && typeof cached === 'object') {
      return {
        onboarding,
        asaasConnection,
        myAccountStatus: null,
        documents: cached as AsaasMyAccountDocumentsResponse,
        documentsRequired: computeDocumentsRequired(cached as AsaasMyAccountDocumentsResponse),
      };
    }
  }

  const [myAccountStatus, documents] = await Promise.all([
    getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: opts.bypassCache, intent: 'READ_MODEL' }),
    getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: opts.bypassCache, intent: 'READ_MODEL' }),
  ]);

  if (myAccountStatus?.general) {
    await financeProfileService.syncRegulatoryState({
      contaId,
      asaasAccountId: asaasAccount?.asaasAccountId ?? null,
      generalStatus: myAccountStatus.general,
      syncedAt: new Date(),
      source: 'READ_MODEL',
    });
  }

  if (asaasAccount?.id) {
    const commercialInfoState = resolveCommercialInfoState({
      myAccountStatus,
      persistedStatus: asaasAccount.commercialInfoStatus ?? null,
      persistedScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
    });
    const cachePayload = buildCacheV2({
      documents,
      myAccountStatus,
      fetchedAt: new Date().toISOString(),
    });
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        commercialInfoStatus: commercialInfoState.commercialInfoStatus,
        commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
        documentsCache: cachePayload as unknown as object,
        documentsCacheUpdatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  return {
    onboarding,
    asaasConnection,
    myAccountStatus,
    documents,
    documentsRequired: computeDocumentsRequired(documents),
  };
}
