import {
  parseAsaasEnvironmentFromEnv,
  type AsaasAccountDocumentResponsible,
  type AsaasMyAccountDocumentGroup,
} from '@alusa/asaas';

import {
  filterTemplateDescription,
  type KycNextAction,
  type KycSlotInfo,
} from '../../dtos/kyc/kyc-snapshot.dto';
import type { CachedGroupMeta } from './kyc-cache-utils';
import { deriveSlotLabel as deriveSlotLabelUtil } from './kyc-label-utils';

export const DOCUMENTS_READY_DELAY_MS = 15_000;
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const PROVISIONING_TIMEOUT_MS_SANDBOX = 2 * 60_000;
const PROVISIONING_TIMEOUT_MS_PRODUCTION = 10 * 60_000;
const ACTIONABLE_STATUSES = new Set(['NOT_SENT', 'REJECTED']);

type ResponsibleMeta = { name?: string; type?: string } | null;

function isSandboxEnvironment(): boolean {
  const env = parseAsaasEnvironmentFromEnv();
  if (env === 'sandbox') return true;
  if (env === 'production') return false;

  const baseUrl = (process.env.ASAAS_BASE_URL ?? '').toLowerCase();
  return baseUrl.includes('api-sandbox.asaas.com');
}

function getProvisioningTimeoutMs(): number {
  return isSandboxEnvironment() ? PROVISIONING_TIMEOUT_MS_SANDBOX : PROVISIONING_TIMEOUT_MS_PRODUCTION;
}

export function isZeroUuid(id: string): boolean {
  return id === ZERO_UUID;
}

export function isActionableDocumentGroupStatus(status: string | null | undefined): boolean {
  return ACTIONABLE_STATUSES.has(String(status ?? '').trim().toUpperCase());
}

export function parseAsaasDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    const normalized = new Date(raw.replace(' ', 'T') + 'Z');
    if (!Number.isNaN(normalized.getTime())) return normalized;
  }

  return null;
}

export function isOnboardingUrlExpired(value: { onboardingUrlExpirationDate?: string | null }): boolean | undefined {
  const exp = parseAsaasDateTime(value.onboardingUrlExpirationDate);
  if (!exp) return undefined;
  return exp.getTime() <= Date.now();
}

export function hasAnyExpiredOnboardingUrl(groups: AsaasMyAccountDocumentGroup[]): boolean {
  return groups.some((group) => Boolean(group.onboardingUrl) && isOnboardingUrlExpired(group) === true);
}

export function normalizeResponsibleMeta(responsible?: AsaasAccountDocumentResponsible | null): ResponsibleMeta {
  if (!responsible) return null;

  const type = Array.isArray(responsible.type)
    ? responsible.type.filter((value): value is string => typeof value === 'string').join(',') || undefined
    : typeof responsible.type === 'string'
      ? responsible.type
      : undefined;

  return {
    name: typeof responsible.name === 'string' ? responsible.name : undefined,
    type,
  };
}

export function normalizeCachedResponsibleMeta(
  responsible?: CachedGroupMeta['responsible'],
): ResponsibleMeta {
  if (!responsible) return null;
  return {
    name: typeof responsible.name === 'string' ? responsible.name : undefined,
    type: typeof responsible.type === 'string' ? responsible.type : undefined,
  };
}

export function deriveSlotsFromDocuments(
  docs: Array<{ id: string; status?: string | null }> | undefined,
): KycSlotInfo[] | undefined {
  if (!docs || docs.length <= 1) return undefined;

  return docs.map((doc, index) => ({
    id: doc.id,
    label: deriveSlotLabelUtil(index, docs.length),
    status: String(doc.status ?? 'NOT_SENT').toUpperCase(),
  }));
}

type CommonGroup = {
  id: string;
  status: string | null | undefined;
  type?: string | null;
  title?: string | null;
  description?: string | null;
};

function resolveProvisioningAction(params: {
  group: CommonGroup;
  provisionedAt: Date | null;
  description?: string;
  responsible?: ResponsibleMeta;
}): KycNextAction {
  const provisionedAgeMs = params.provisionedAt ? Date.now() - params.provisionedAt.getTime() : null;
  const timedOut = provisionedAgeMs === null || provisionedAgeMs >= getProvisioningTimeoutMs();

  return {
    kind: timedOut ? 'PROVISIONING_TIMEOUT' : 'WAITING_PROVIDER',
    groupId: params.group.id,
    groupStatus: String(params.group.status ?? '').toUpperCase(),
    type: params.group.type?.trim().toUpperCase() ?? null,
    title: params.group.title?.trim() || 'Verificação pendente',
    description: params.description,
    responsible: params.responsible ?? null,
    submissionMethod: params.group && (params.group as any).onboardingUrl ? 'EXTERNAL_ONBOARDING_URL' : 'INTERNAL_UPLOAD',
  };
}

export function resolveNextActionFromLiveGroup(
  group: AsaasMyAccountDocumentGroup,
  provisionedAt: Date | null,
): KycNextAction | null {
  const groupStatus = String(group.status ?? '').toUpperCase();
  if (groupStatus === 'IGNORED' || !isActionableDocumentGroupStatus(groupStatus)) {
    return null;
  }

  const description = filterTemplateDescription(group.description);
  const responsible = normalizeResponsibleMeta(group.responsible);
  const commonGroup: CommonGroup = {
    id: group.id,
    status: groupStatus,
    type: group.type ?? null,
    title: group.title ?? null,
    description: group.description ?? null,
  };

  if (isZeroUuid(group.id) && (!group.onboardingUrl || isOnboardingUrlExpired(group) === true)) {
    return resolveProvisioningAction({ group: commonGroup, provisionedAt, description, responsible });
  }

  if (group.onboardingUrl) {
    return {
      kind: 'EXTERNAL_ONBOARDING',
      groupId: group.id,
      groupStatus,
      type: group.type?.trim().toUpperCase() ?? null,
      title: group.title?.trim() || 'Continuar verificação',
      description,
      onboardingUrl: group.onboardingUrl,
      onboardingUrlExpirationDate: group.onboardingUrlExpirationDate ?? null,
      isOnboardingUrlExpired: isOnboardingUrlExpired(group) === true,
      responsible,
      submissionMethod: 'EXTERNAL_ONBOARDING_URL',
    };
  }

  return {
    kind: 'UPLOAD_DOCUMENT',
    groupId: group.id,
    groupStatus,
    type: group.type?.trim().toUpperCase() ?? null,
    title: group.title?.trim() || 'Enviar documento',
    description,
    slots: deriveSlotsFromDocuments(group.documents),
    responsible,
    submissionMethod: group.onboardingUrl ? 'EXTERNAL_ONBOARDING_URL' : 'INTERNAL_UPLOAD',
  };
}

export function resolveNextActionFromCachedGroup(
  group: CachedGroupMeta,
  provisionedAt: Date | null,
): KycNextAction | null {
  const groupStatus = String(group.status ?? '').toUpperCase();
  if (groupStatus === 'IGNORED' || !isActionableDocumentGroupStatus(groupStatus)) {
    return null;
  }

  const description = filterTemplateDescription(group.description);
  const responsible = normalizeCachedResponsibleMeta(group.responsible);
  const commonGroup: CommonGroup = {
    id: group.id,
    status: groupStatus,
    type: group.type ?? null,
    title: group.title ?? null,
    description: group.description ?? null,
  };

  if (isZeroUuid(group.id) && !group.hasOnboardingUrl) {
    return resolveProvisioningAction({ group: commonGroup, provisionedAt, description, responsible });
  }

  if (group.hasOnboardingUrl) {
    return {
      kind: 'EXTERNAL_ONBOARDING',
      groupId: group.id,
      groupStatus,
      type: group.type?.trim().toUpperCase() ?? null,
      title: group.title?.trim() || 'Continuar verificação',
      description,
      responsible,
      submissionMethod: 'EXTERNAL_ONBOARDING_URL',
    };
  }

  return {
    kind: 'UPLOAD_DOCUMENT',
    groupId: group.id,
    groupStatus,
    type: group.type?.trim().toUpperCase() ?? null,
    title: group.title?.trim() || 'Enviar documento',
    description,
    slots: deriveSlotsFromDocuments(group.documents),
    responsible,
    submissionMethod: group.hasOnboardingUrl ? 'EXTERNAL_ONBOARDING_URL' : 'INTERNAL_UPLOAD',
  };
}
