/**
 * KYC Engine Central
 *
 * Única entrada para obter o estado normalizado de KYC de uma subconta Asaas.
 * Deriva tudo de GET /myAccount/status + GET /myAccount/documents.
 *
 * Regras:
 * - onboardingUrl nunca é persistida em cache (buscada fresh sob demanda).
 * - hasBlockingPending = true quando general/documentation/bankAccountInfo !== APPROVED.
 * - nextActions derivadas dos grupos de documentos pendentes.
 */

import {
  AsaasHttpError,
  getAsaasBaseUrlFromEnvOrThrow,
  type AsaasMyAccountDocumentGroup,
  type AsaasMyAccountDocumentsResponse,
  type AsaasMyAccountStatus,
} from '@alusa/asaas';
import { prisma, loadAsaasCredentials } from '@alusa/database';

import { financeProfileService } from '../../foundation/finance-profile.service';
import {
  type KycSnapshot,
  type KycAreaStatus,
  normalizeAreaStatus,
  isAreaBlocking,
} from '../../dtos/kyc/kyc-snapshot.dto';
import {
  type KycSnapshotCacheV2,
  isCacheV2,
  buildCacheV2,
  normalizeRejectReasons,
  resolveCommercialInfoState,
} from './kyc-cache-utils';
import { getMyAccountDocumentsCached, getMyAccountStatusCached } from './kyc-asaas-read-cache';
import { syncKycModels, deriveProcessStatus } from './kyc-persistence.service';
import {
  DOCUMENTS_READY_DELAY_MS,
  hasAnyExpiredOnboardingUrl,
  isZeroUuid,
  resolveNextActionFromCachedGroup,
  resolveNextActionFromLiveGroup,
} from './kyc-document-group-resolver';

// ── Constantes ───────────────────────────────────────────────────────────

const KYC_CACHE_TTL_MS = 60_000;
const KYC_STALE_CACHE_FALLBACK_TTL_MS = 10 * 60_000;

function isSandboxEnvironment(): boolean {
  return (process.env.ASAAS_ENVIRONMENT ?? '').toLowerCase() === 'sandbox'
    || (process.env.ASAAS_BASE_URL ?? '').toLowerCase().includes('api-sandbox.asaas.com');
}

function isRetryableAsaasError(error: unknown): boolean {
  // Tratar 429 (Too Many Requests) como retryable para permitir fallback
  // para snapshot em cache quando o provedor estiver limitando requisições.
  return error instanceof AsaasHttpError && [429, 502, 503, 504].includes(error.status);
}

function deriveNextActions(
  groups: AsaasMyAccountDocumentGroup[],
  _bankAccountStatus: KycAreaStatus,
  provisionedAt: Date | null,
) {
  return groups
    .map((group) => resolveNextActionFromLiveGroup(group, provisionedAt))
    .filter((action): action is NonNullable<typeof action> => Boolean(action));
}

/** Constrói snapshot a partir de dados fresh do Asaas */
function buildSnapshotFromFresh(
  myAccountStatus: AsaasMyAccountStatus,
  documents: AsaasMyAccountDocumentsResponse,
  fetchedAt: string,
  commercialInfoState: ReturnType<typeof resolveCommercialInfoState>,
  provisionedAt: Date | null,
): KycSnapshot {
  const generalStatus = normalizeAreaStatus(myAccountStatus.general);
  const documentationStatus = normalizeAreaStatus(myAccountStatus.documentation);
  const bankAccountStatus = normalizeAreaStatus(myAccountStatus.bankAccountInfo);
  const commercialInfoAreaStatus = normalizeAreaStatus(myAccountStatus.commercialInfo);

  const hasBlockingPending =
    isAreaBlocking(generalStatus) || isAreaBlocking(documentationStatus) || isAreaBlocking(bankAccountStatus);

  return {
    generalStatus,
    documentationStatus,
    bankAccountStatus,
    commercialInfoAreaStatus,
    processStatus: deriveProcessStatus(myAccountStatus, documents.data),
    commercialInfoStatus: commercialInfoState.commercialInfoStatus,
    commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
    commercialInfoExpiration: commercialInfoState.commercialInfoExpiration,
    hasBlockingPending,
    nextActions: deriveNextActions(documents.data, bankAccountStatus, provisionedAt),
    rejectReasons: normalizeRejectReasons(documents.rejectReasons),
    fetchedAt,
    isSandbox: isSandboxEnvironment(),
  };
}

/** Constrói snapshot a partir do cache v2 (sem onboardingUrl — será completado com fresh se necessário) */
function buildSnapshotFromCache(
  cache: KycSnapshotCacheV2,
  commercialInfoState: ReturnType<typeof resolveCommercialInfoState>,
  provisionedAt: Date | null,
): KycSnapshot {
  const generalStatus = normalizeAreaStatus(cache.myAccountStatus?.general);
  const documentationStatus = normalizeAreaStatus(cache.myAccountStatus?.documentation);
  const bankAccountStatus = normalizeAreaStatus(cache.myAccountStatus?.bankAccountInfo);
  const commercialInfoAreaStatus = normalizeAreaStatus(cache.myAccountStatus?.commercialInfo);

  const hasBlockingPending =
    isAreaBlocking(generalStatus) || isAreaBlocking(documentationStatus) || isAreaBlocking(bankAccountStatus);

  const nextActions = cache.groups
    .map((group) => resolveNextActionFromCachedGroup(group, provisionedAt))
    .filter((action): action is NonNullable<typeof action> => Boolean(action));

  // Adaptar cache groups para deriveProcessStatus (espera onboardingUrl truthy/falsy)
  const adaptedGroups = cache.groups.map((g) => ({
    onboardingUrl: g.hasOnboardingUrl ? 'cached' : undefined,
    status: g.status,
  })) as unknown as AsaasMyAccountDocumentGroup[];

  return {
    generalStatus,
    documentationStatus,
    bankAccountStatus,
    commercialInfoAreaStatus,
    processStatus: deriveProcessStatus(cache.myAccountStatus ?? null, adaptedGroups),
    commercialInfoStatus: commercialInfoState.commercialInfoStatus,
    commercialInfoScheduledDate: commercialInfoState.commercialInfoScheduledDate,
    commercialInfoExpiration: commercialInfoState.commercialInfoExpiration,
    hasBlockingPending,
    nextActions,
    rejectReasons: cache.rejectReasons ?? [],
    fetchedAt: cache.fetchedAt,
    isSandbox: isSandboxEnvironment(),
  };
}

// ── Ponto de entrada público ─────────────────────────────────────────────

export type GetKycSnapshotOptions = {
  /** Força busca fresh no Asaas (ignora cache). Default: false */
  fresh?: boolean;
};

/**
 * Retorna o snapshot canônico de KYC de uma conta.
 *
 * - Usa cache v2 quando válido e fresh=false.
 * - Faz a decisão de retry progressivo pós-provisioning.
 * - Persiste cache v2 sem onboardingUrl em claro.
 * - Sincroniza regulatoryState quando general muda.
 *
 * @returns null quando credenciais não estão disponíveis ou subconta recém-criada (retry).
 */
export async function getKycSnapshot(
  financeProfileId: string,
  opts: GetKycSnapshotOptions = {},
): Promise<KycSnapshot | null> {
  // Fail-fast: ASAAS_BASE_URL
  try {
    getAsaasBaseUrlFromEnvOrThrow();
  } catch {
    return null;
  }

  // Buscar conta financeira + subconta Asaas
  const financeProfile = await prisma.financeProfile.findUnique({
    where: { id: financeProfileId },
    select: { id: true, contaId: true },
  });
  if (!financeProfile) return null;

  const creds = await loadAsaasCredentials(financeProfile.contaId);
  if (!creds) return null;

  const asaasAccount = await prisma.asaasAccount.findUnique({
    where: { financeProfileId },
    select: {
      id: true,
      asaasAccountId: true,
      provisionedAt: true,
      documentsCache: true,
      documentsCacheUpdatedAt: true,
      commercialInfoStatus: true,
      commercialInfoScheduledDate: true,
    },
  });

  // Retry progressivo pós-provisioning e avaliação de cache usam o mesmo relógio.
  const nowMs = Date.now();

  const staleCacheSnapshot = (() => {
    if (!asaasAccount?.documentsCache) return null;

    const cached = asaasAccount.documentsCache as unknown;
    if (!isCacheV2(cached)) return null;

    const cacheHasZeroUuids = cached.groups.length > 0 && cached.groups.every((g) => isZeroUuid(g.id));
    if (cacheHasZeroUuids) return null;

    const cacheAgeMs = asaasAccount.documentsCacheUpdatedAt
      ? nowMs - asaasAccount.documentsCacheUpdatedAt.getTime()
      : null;

    if (
      typeof cacheAgeMs !== 'number' ||
      cacheAgeMs < 0 ||
      cacheAgeMs >= KYC_STALE_CACHE_FALLBACK_TTL_MS
    ) {
      return null;
    }

    return buildSnapshotFromCache(
      cached,
      resolveCommercialInfoState({
        myAccountStatus: cached.myAccountStatus,
        persistedStatus: asaasAccount.commercialInfoStatus ?? null,
        persistedScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
      }),
      asaasAccount.provisionedAt ?? null,
    );
  })();

  // Retry progressivo pós-provisioning: 0s/15s espera antes de chamar Asaas
  const provisionedAgeMs = asaasAccount?.provisionedAt
    ? nowMs - asaasAccount.provisionedAt.getTime()
    : null;

  if (
    typeof provisionedAgeMs === 'number' &&
    provisionedAgeMs >= 0 &&
    provisionedAgeMs < DOCUMENTS_READY_DELAY_MS
  ) {
    return null;
  }

  // Cache check (v2 only)
  if (!opts.fresh && asaasAccount?.documentsCache) {
    const cached = asaasAccount.documentsCache as unknown;
    if (isCacheV2(cached)) {
      // Cache com zero UUID = Asaas não havia provisionado ainda; força fresh.
      const cacheHasZeroUuids = cached.groups.length > 0 && cached.groups.every((g) => isZeroUuid(g.id));
      if (!cacheHasZeroUuids) {
        const cacheAgeMs = asaasAccount.documentsCacheUpdatedAt
          ? nowMs - asaasAccount.documentsCacheUpdatedAt.getTime()
          : null;

        if (typeof cacheAgeMs === 'number' && cacheAgeMs >= 0 && cacheAgeMs < KYC_CACHE_TTL_MS) {
          return buildSnapshotFromCache(
            cached,
            resolveCommercialInfoState({
              myAccountStatus: cached.myAccountStatus,
              persistedStatus: asaasAccount.commercialInfoStatus ?? null,
              persistedScheduledDate: asaasAccount.commercialInfoScheduledDate ?? null,
            }),
            asaasAccount.provisionedAt ?? null,
          );
        }
      }
    }
    // Cache v1 (legado) ou zero UUID → ignora, busca fresh
  }

  // Busca fresh no Asaas
  let myAccountStatus: AsaasMyAccountStatus;
  let initialDocuments: AsaasMyAccountDocumentsResponse;

  try {
    [myAccountStatus, initialDocuments] = await Promise.all([
      getMyAccountStatusCached({ apiKey: creds.apiKey }, { forceRefresh: Boolean(opts.fresh), intent: 'READ_MODEL' }),
      getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: Boolean(opts.fresh), intent: 'READ_MODEL' }),
    ]);
  } catch (error) {
    if (isRetryableAsaasError(error)) {
      if (staleCacheSnapshot) {
        return staleCacheSnapshot;
      }
      return null;
    }
    throw error;
  }

  // Se houver onboardingUrl expirado, tenta 1 refresh adicional de documentos.
  // Motivo: o Asaas pode reemitir link em alguns cenários; não inferimos, apenas reconsultamos.
  const documents = hasAnyExpiredOnboardingUrl(initialDocuments.data)
    ? await getMyAccountDocumentsCached({ apiKey: creds.apiKey }, { forceRefresh: true, intent: 'READ_MODEL' }).catch((error) => {
        if (isRetryableAsaasError(error) && staleCacheSnapshot) {
          return initialDocuments;
        }
        return initialDocuments;
      })
    : initialDocuments;

  const fetchedAt = new Date().toISOString();

  // Sync regulatory state quando mudou
  if (myAccountStatus?.general) {
    await financeProfileService.syncRegulatoryState({
      contaId: financeProfile.contaId,
      asaasAccountId: asaasAccount?.asaasAccountId ?? null,
      generalStatus: myAccountStatus.general,
      syncedAt: new Date(),
    });
  }

  // Persistir cache v2
  if (asaasAccount?.id) {
    const cachePayload = buildCacheV2({ myAccountStatus, documents, fetchedAt });
    await prisma.asaasAccount.update({
      where: { id: asaasAccount.id },
      data: {
        documentsCache: cachePayload as unknown as object,
        documentsCacheUpdatedAt: new Date(),
      },
      select: { id: true },
    });

    // Persistir KYC models (idempotente)
    await syncKycModels({
      asaasAccountId: asaasAccount.id,
      myAccountStatus,
      documents,
    }).catch(() => {
      // best-effort: se falhar, o cache v2 já foi salvo
    });
  }

  return buildSnapshotFromFresh(
    myAccountStatus,
    documents,
    fetchedAt,
    resolveCommercialInfoState({
      myAccountStatus,
      persistedStatus: asaasAccount?.commercialInfoStatus ?? null,
      persistedScheduledDate: asaasAccount?.commercialInfoScheduledDate ?? null,
    }),
    asaasAccount?.provisionedAt ?? null,
  );
}

// ── Atalhos por contaId (compatibilidade com consumers existentes) ──────

export async function getKycSnapshotByContaId(
  contaId: string,
  opts: GetKycSnapshotOptions = {},
): Promise<KycSnapshot | null> {
  const fp = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { id: true },
  });
  if (!fp) return null;
  return getKycSnapshot(fp.id, opts);
}
