import { prisma } from '@alusa/database';
import type { AsaasMyAccountDocumentGroup } from '@alusa/asaas';

import type { KycDocumentItem, KycGateStatus, KycUiNextAction, KycViewModel } from '../../dtos/kyc/kyc-view-model.dto';
import { getKycSummary, getKycSummaryFresh } from './get-kyc-summary';

const INTERNAL_ACCEPT = ['application/pdf', 'image/jpeg', 'image/png'];
const INTERNAL_MAX_SIZE_MB = 10;
const KYC_CACHE_TTL_MS = 60_000;

const DOCUMENT_TYPE_LABELS: Record<string, { title: string; description?: string }> = {
  IDENTIFICATION: {
    title: 'Documento com foto',
    description: 'Envie a frente e o verso de um documento oficial com foto do titular, como RG ou CNH, com os dados legíveis.',
  },
  IDENTIFICATION_SELFIE: {
    title: 'Selfie de identificação',
    description: 'Envie uma selfie nítida do titular, com o rosto visível e boa iluminação.',
  },
  INVOICE: { title: 'Nota fiscal' },
  MEI_CERTIFICATE: { title: 'Certificado MEI' },
  MINUTES_OF_CONSTITUTION: { title: 'Ata de constituição' },
  MINUTES_OF_ELECTION: { title: 'Ata de eleição' },
  POWER_OF_ATTORNEY: { title: 'Procuração' },
  SOCIAL_CONTRACT: { title: 'Contrato social' },
  ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT: { title: 'Comprovante de depósito bancário' },
  ENTREPRENEUR_REQUIREMENT: { title: 'Requerimento de empresário' },
  EMANCIPATION_OF_MINORS: { title: 'Emancipação de menor' },
};

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function normalizeDocumentType(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toUpperCase();
  return normalized ? normalized : null;
}

function resolveGroupStatus(group: AsaasMyAccountDocumentGroup): string {
  const direct = normalizeStatus(group.status);
  if (direct && direct !== 'UNKNOWN') return direct;

  const statuses = (group.documents ?? [])
    .map((doc) => normalizeStatus(doc.status))
    .filter((status) => status);

  if (!statuses.length) return 'UNKNOWN';
  if (statuses.includes('REJECTED')) return 'REJECTED';
  if (statuses.includes('NOT_SENT')) return 'NOT_SENT';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.every((status) => status === 'APPROVED')) return 'APPROVED';
  return statuses[0] ?? 'UNKNOWN';
}

function resolveGroupType(group: AsaasMyAccountDocumentGroup): string | null {
  const direct = normalizeDocumentType(group.type);
  if (direct) return direct;

  for (const doc of group.documents ?? []) {
    const docType = normalizeDocumentType(doc.type);
    if (docType) return docType;
  }

  return null;
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

function mapGroupStatusToItemStatus(status: string): KycDocumentItem['status'] {
  if (!status || status === 'UNKNOWN') return 'UNKNOWN';
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'APPROVED') return 'APPROVED';
  if (status === 'PENDING') return 'SENT';
  if (status === 'AWAITING_APPROVAL') return 'SENT';
  if (status === 'NOT_SENT') return 'PENDING';
  return 'UNKNOWN';
}

function buildTitleForGroup(group: AsaasMyAccountDocumentGroup, type: string | null): { title: string; description?: string } {
  if (type === 'CUSTOM') {
    const description = group.description?.trim();
    const title = group.title?.trim() || description || 'Documento adicional';
    return description && description !== title ? { title, description } : { title };
  }

  if (type && DOCUMENT_TYPE_LABELS[type]) {
    return DOCUMENT_TYPE_LABELS[type];
  }

  const fallbackTitle = group.title?.trim();
  if (fallbackTitle) return { title: fallbackTitle };

  return { title: 'Documento adicional' };
}

function buildUiIdBase(params: {
  group: AsaasMyAccountDocumentGroup;
  type: string | null;
  method: KycDocumentItem['method'];
}): string {
  const title = params.group.title?.trim() ?? '';
  const description = params.group.description?.trim() ?? '';
  const onboardingUrl = params.group.onboardingUrl?.trim() ?? '';
  const onboardingExpiration = params.group.onboardingUrlExpirationDate?.trim() ?? '';
  const parts = [
    params.group.id,
    params.type ?? 'UNKNOWN',
    params.method,
    title,
    description,
    onboardingUrl,
    onboardingExpiration,
  ].filter(Boolean);

  return parts.join('|');
}

function buildDocumentItem(group: AsaasMyAccountDocumentGroup): KycDocumentItem {
  const groupStatus = resolveGroupStatus(group);
  const type = resolveGroupType(group);
  const types = resolveGroupDocumentTypes(group);
  const { title, description } = buildTitleForGroup(group, type);

  const method = group.onboardingUrl ? 'EXTERNAL' : 'INTERNAL';

  const status = mapGroupStatusToItemStatus(groupStatus);
  const uiId = buildUiIdBase({ group, type, method });

  return {
    uiId,
    id: group.id,
    title,
    description,
    method,
    status,
    ...(method === 'EXTERNAL' && group.onboardingUrl ? { external: { url: group.onboardingUrl } } : {}),
    ...(method === 'INTERNAL'
      ? {
          internal: {
            accept: INTERNAL_ACCEPT,
            maxSizeMb: INTERNAL_MAX_SIZE_MB,
            ...(types.length > 0 ? { types } : {}),
          },
        }
      : {}),
  };
}

function buildNextAction(params: {
  pendingExternal: KycDocumentItem[];
  pendingInternal: KycDocumentItem[];
  gateStatus: KycGateStatus;
  retryAfterSeconds?: number;
}): KycUiNextAction {
  if (params.gateStatus === 'WAITING_REQUIREMENTS') {
    return {
      type: 'WAIT',
      retryAfterSeconds: params.retryAfterSeconds ?? 15,
      reason: 'INITIAL_DELAY',
    };
  }

  if (params.pendingExternal[0]?.external?.url) {
    return {
      type: 'OPEN_EXTERNAL',
      url: params.pendingExternal[0].external!.url,
      label: params.gateStatus === 'REJECTED' ? 'Reenviar documentos' : 'Enviar documentos',
    };
  }

  if (params.pendingInternal[0]) {
    return {
      type: 'UPLOAD_INTERNAL',
      documentId: params.pendingInternal[0].id,
      label: 'Enviar arquivo',
    };
  }

  return { type: 'NONE' };
}

function buildMessage(params: {
  gateStatus: KycGateStatus;
  hasExternal: boolean;
}): KycViewModel['message'] {
  switch (params.gateStatus) {
    case 'WAITING_REQUIREMENTS':
      return {
        title: 'Preparando verificação',
        body: 'Estamos carregando as etapas necessárias para liberar sua conta. Tente novamente em instantes.',
        tone: 'INFO',
      };
    case 'ACTION_REQUIRED':
      return params.hasExternal
        ? {
            title: 'Envie seus documentos',
            body: 'Você será direcionado para uma página segura para concluir o envio.',
            tone: 'INFO',
          }
        : {
            title: 'Envie um documento',
            body: 'Precisamos de alguns arquivos para concluir sua verificação.',
            tone: 'INFO',
          };
    case 'REJECTED':
      return {
        title: 'Precisamos de uma correção',
        body: 'Um ou mais documentos precisam ser reenviados.',
        tone: 'WARNING',
      };
    case 'UNDER_REVIEW':
    case 'SUBMITTED':
      return {
        title: 'Em análise',
        body: 'Recebemos suas informações. Você será avisado quando estiver tudo pronto.',
        tone: 'INFO',
      };
    case 'NOT_REQUIRED':
      return {
        title: 'Tudo certo',
        body: 'Sua verificação está concluída.',
        tone: 'SUCCESS',
      };
    case 'ERROR':
    default:
      return {
        title: 'Não foi possível verificar agora',
        body: 'Tente novamente em alguns instantes.',
        tone: 'ERROR',
      };
  }
}

function resolveGateStatus(params: {
  pendingCount: number;
  hasRejected: boolean;
  documentationStatus?: string | null;
  generalStatus?: string | null;
}): KycGateStatus {
  const documentation = normalizeStatus(params.documentationStatus ?? '');
  const general = normalizeStatus(params.generalStatus ?? '');

  if (documentation === 'APPROVED' || general === 'APPROVED') return 'NOT_REQUIRED';
  if (documentation === 'PENDING' || documentation === 'AWAITING_APPROVAL') return 'UNDER_REVIEW';
  if (documentation === 'REJECTED') return 'REJECTED';

  if (params.pendingCount > 0) {
    return params.hasRejected ? 'REJECTED' : 'ACTION_REQUIRED';
  }

  return 'SUBMITTED';
}

function resolveBlockingReason(gateStatus: KycGateStatus): KycViewModel['blockingReason'] {
  if (gateStatus === 'NOT_REQUIRED') return 'NONE';
  if (gateStatus === 'UNDER_REVIEW' || gateStatus === 'SUBMITTED') return 'ACCOUNT_ANALYSIS';
  return 'KYC_PENDING';
}

function resolveRefreshHintSeconds(cacheUpdatedAt: Date | null): number | undefined {
  if (!cacheUpdatedAt) return undefined;
  const ageMs = Date.now() - cacheUpdatedAt.getTime();
  if (ageMs < 0) return undefined;
  const remaining = Math.ceil((KYC_CACHE_TTL_MS - ageMs) / 1000);
  return remaining > 0 ? remaining : undefined;
}

export async function getKycViewModel(contaId: string): Promise<KycViewModel> {
  return getKycViewModelInternal(contaId, { bypassCache: false });
}

export async function getKycViewModelFresh(contaId: string): Promise<KycViewModel> {
  return getKycViewModelInternal(contaId, { bypassCache: true });
}

async function getKycViewModelInternal(
  contaId: string,
  opts: { bypassCache: boolean },
): Promise<KycViewModel> {
  const summary = opts.bypassCache ? await getKycSummaryFresh(contaId) : await getKycSummary(contaId);
  const account = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: { documentsCacheUpdatedAt: true },
  });

  const lastCheckedAt = account?.documentsCacheUpdatedAt?.toISOString();
  const refreshHintSeconds = resolveRefreshHintSeconds(account?.documentsCacheUpdatedAt ?? null);
  if (summary.asaasConnection.status === 'MISCONFIGURED') {
    const gateStatus: KycGateStatus = 'ERROR';
    return {
      gateStatus,
      documentsRequired: false,
      canUseProduct: false,
      blockingReason: resolveBlockingReason(gateStatus),
      pendingExternal: [],
      pendingInternal: [],
      completed: [],
      nextAction: { type: 'WAIT', retryAfterSeconds: 30, reason: 'RETRY' },
      lastCheckedAt,
      refreshHintSeconds,
      message: buildMessage({ gateStatus, hasExternal: false }),
    };
  }

  if (summary.asaasConnection.status === 'NOT_CONNECTED') {
    const gateStatus: KycGateStatus = 'WAITING_REQUIREMENTS';
    return {
      gateStatus,
      documentsRequired: false,
      canUseProduct: false,
      blockingReason: resolveBlockingReason(gateStatus),
      pendingExternal: [],
      pendingInternal: [],
      completed: [],
      nextAction: { type: 'WAIT', retryAfterSeconds: 15, reason: 'RETRY' },
      lastCheckedAt,
      refreshHintSeconds,
      message: buildMessage({ gateStatus, hasExternal: false }),
    };
  }

  if (summary.documentsNotReady) {
    const retryAfterSeconds = typeof summary.retryAfterMs === 'number' ? Math.max(1, Math.ceil(summary.retryAfterMs / 1000)) : 15;
    const gateStatus: KycGateStatus = 'WAITING_REQUIREMENTS';
    const nextAction = buildNextAction({
      pendingExternal: [],
      pendingInternal: [],
      gateStatus,
      retryAfterSeconds,
    });

    return {
      gateStatus,
      documentsRequired: false,
      canUseProduct: false,
      blockingReason: resolveBlockingReason(gateStatus),
      pendingExternal: [],
      pendingInternal: [],
      completed: [],
      nextAction,
      lastCheckedAt,
      refreshHintSeconds,
      message: buildMessage({ gateStatus, hasExternal: false }),
    };
  }

  const documentationStatus = summary.myAccountStatus?.documentation ?? null;
  const generalStatus = summary.myAccountStatus?.general ?? null;
  const normalizedGeneral = normalizeStatus(generalStatus ?? '');

  if (normalizedGeneral === 'APPROVED') {
    const gateStatus: KycGateStatus = 'NOT_REQUIRED';
    return {
      gateStatus,
      documentsRequired: false,
      canUseProduct: true,
      blockingReason: resolveBlockingReason(gateStatus),
      pendingExternal: [],
      pendingInternal: [],
      completed: [],
      nextAction: { type: 'NONE' },
      lastCheckedAt,
      refreshHintSeconds,
      message: buildMessage({ gateStatus, hasExternal: false }),
    };
  }

  const groups = summary.documents?.data ?? [];
  const relevantGroups = groups.filter((group) => normalizeStatus(group.status) !== 'IGNORED');
  const items = relevantGroups.map(buildDocumentItem);
  const uiIdCounts = new Map<string, number>();
  const itemsWithUniqueUiId = items.map((item) => {
    const base = item.uiId;
    const count = uiIdCounts.get(base) ?? 0;
    uiIdCounts.set(base, count + 1);
    if (count === 0) return item;
    return { ...item, uiId: `${base}::${count + 1}` };
  });

  const pending = itemsWithUniqueUiId.filter((item) => item.status === 'PENDING' || item.status === 'REJECTED');
  const pendingExternal = pending.filter((item) => item.method === 'EXTERNAL');
  const pendingInternal = pending.filter((item) => item.method === 'INTERNAL');
  const completed = itemsWithUniqueUiId.filter((item) => item.status === 'SENT' || item.status === 'APPROVED');
  const unknown = itemsWithUniqueUiId.filter((item) => item.status === 'UNKNOWN');
  const hasRejected = pending.some((item) => item.status === 'REJECTED');

  let gateStatus = resolveGateStatus({
    pendingCount: pending.length,
    hasRejected,
    documentationStatus,
    generalStatus,
  });

  let nextAction = buildNextAction({
    pendingExternal,
    pendingInternal,
    gateStatus,
  });

  if (gateStatus === 'SUBMITTED' && pending.length === 0 && unknown.length > 0) {
    gateStatus = 'WAITING_REQUIREMENTS';
    nextAction = { type: 'WAIT', retryAfterSeconds: 15, reason: 'RETRY' };
  }

  const canUseProduct = gateStatus === 'NOT_REQUIRED';

  return {
    gateStatus,
    documentsRequired: pending.length > 0,
    canUseProduct,
    blockingReason: resolveBlockingReason(gateStatus),
    pendingExternal,
    pendingInternal,
    completed,
    nextAction,
    lastCheckedAt,
    refreshHintSeconds,
    message: buildMessage({ gateStatus, hasExternal: pendingExternal.length > 0 }),
  };
}
