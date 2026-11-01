import { randomUUID } from 'node:crypto';
import { logFinanceOperationalEvent } from '../foundation/operational-log';
import type { AsaasNotificationEvent, AsaasNotificationPreference } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { getAsaasBaseUrlForApiKeyOrThrow } from '@alusa/asaas';
import { decryptSecret, prisma } from '@alusa/database';
import { loadTenantNotificationEventPreferences } from '@alusa/lib/notifications/tenant-notification-preferences';

async function loadDecryptedAsaasCredentials(contaId: string) {
  const [profile, conta] = await Promise.all([
    prisma.financeProfile.findUnique({
      where: { contaId },
      select: {
        asaasCredential: { select: { apiKeyEncrypted: true } },
        asaasAccount: { select: { apiKeyEncrypted: true, apiKeyStatus: true } },
      },
    }),
    prisma.conta.findUnique({
      where: { id: contaId },
      select: { asaasApiKeyEncrypted: true, asaasWebhookSecretEncrypted: true },
    }),
  ]);

  const apiKeyEncrypted =
    profile?.asaasAccount?.apiKeyEncrypted ??
    profile?.asaasCredential?.apiKeyEncrypted ??
    conta?.asaasApiKeyEncrypted ??
    null;
  const apiKey = decryptSecret(apiKeyEncrypted);
  const apiKeyStatus = profile?.asaasAccount?.apiKeyStatus ?? (apiKey ? 'CONNECTED' : 'MISSING');

  if (!apiKey || apiKeyStatus !== 'CONNECTED') return null;

  return {
    apiKey,
    webhookSecret: decryptSecret(conta?.asaasWebhookSecretEncrypted),
  };
}

function getAsaasBaseUrl(apiKey: string): string {
  return getAsaasBaseUrlForApiKeyOrThrow(apiKey).replace(/\/$/, '');
}

export type NotificationChannels = {
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
};

export type NotificationPreferenceDTO = NotificationChannels & {
  id: string;
  contaId: string;
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
  customerEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferenceInput = Partial<NotificationChannels> & {
  event: AsaasNotificationEvent;
  scheduleOffset?: number;
  enabled?: boolean;
  customerEnabled?: boolean;
};

export type CustomerNotificationPreferenceDTO = NotificationChannels & {
  id: string;
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
  customerEnabled: boolean;
};

export type CustomerNotificationPreferenceInput = Partial<NotificationChannels> & {
  id?: string;
  event: AsaasNotificationEvent;
  scheduleOffset?: number;
  enabled?: boolean;
  customerEnabled?: boolean;
};

const DEFAULT_NOTIFICATION_PRESETS: NotificationPreferenceInput[] = [
  {
    event: 'PAYMENT_CREATED',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
  {
    event: 'PAYMENT_UPDATED',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
  {
    event: 'PAYMENT_DUEDATE_WARNING',
    scheduleOffset: 10,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
  {
    event: 'PAYMENT_DUEDATE_WARNING',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
  {
    event: 'SEND_LINHA_DIGITAVEL',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
  {
    event: 'PAYMENT_OVERDUE',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: true,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: true,
  },
  {
    event: 'PAYMENT_OVERDUE',
    scheduleOffset: 7,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: true,
  },
  {
    event: 'PAYMENT_RECEIVED',
    scheduleOffset: 0,
    enabled: true,
    customerEnabled: true,
    emailEnabledForProvider: true,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
  },
];

function toDTO(pref: AsaasNotificationPreference): NotificationPreferenceDTO {
  return {
    id: pref.id,
    contaId: pref.contaId,
    event: pref.event,
    scheduleOffset: pref.scheduleOffset,
    enabled: pref.enabled,
    customerEnabled: pref.customerEnabled,
    emailEnabledForProvider: pref.emailEnabledForProvider,
    smsEnabledForProvider: pref.smsEnabledForProvider,
    emailEnabledForCustomer: pref.emailEnabledForCustomer,
    smsEnabledForCustomer: pref.smsEnabledForCustomer,
    whatsappEnabledForCustomer: pref.whatsappEnabledForCustomer,
    phoneCallEnabledForCustomer: pref.phoneCallEnabledForCustomer,
    createdAt: pref.createdAt,
    updatedAt: pref.updatedAt,
  };
}

type SanitizedPreference = NotificationChannels & {
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
  customerEnabled: boolean;
};

function preferenceKey(input: { event: AsaasNotificationEvent; scheduleOffset: number }) {
  return `${input.event}:${input.scheduleOffset}`;
}

function assertSingleScheduledOffset(preferences: Array<{ event: AsaasNotificationEvent; scheduleOffset?: number }>) {
  const scheduledEvents = new Set<AsaasNotificationEvent>();
  for (const preference of preferences) {
    if (!EVENTS_WITH_SCHEDULE_OFFSET.has(preference.event) || (preference.scheduleOffset ?? 0) <= 0) continue;
    if (scheduledEvents.has(preference.event)) {
      throw new Error(`Configure apenas um intervalo de lembrete para ${preference.event}.`);
    }
    scheduledEvents.add(preference.event);
  }
}

function sanitizeInput(input: NotificationPreferenceInput): SanitizedPreference {
  return {
    event: input.event,
    scheduleOffset: input.scheduleOffset ?? 0,
    enabled: input.enabled ?? true,
    customerEnabled: input.customerEnabled ?? true,
    emailEnabledForProvider: input.emailEnabledForProvider ?? false,
    smsEnabledForProvider: input.smsEnabledForProvider ?? false,
    emailEnabledForCustomer: input.emailEnabledForCustomer ?? true,
    smsEnabledForCustomer: input.smsEnabledForCustomer ?? true,
    whatsappEnabledForCustomer: input.whatsappEnabledForCustomer ?? false,
    phoneCallEnabledForCustomer: input.phoneCallEnabledForCustomer ?? false,
  };
}

function normalizePreferenceList(inputs: NotificationPreferenceInput[]): SanitizedPreference[] {
  const byKey = new Map<string, SanitizedPreference>();

  for (const input of inputs) {
    const sanitized = sanitizeInput(input);
    byKey.set(preferenceKey(sanitized), sanitized);
  }

  const normalized = [...byKey.values()];
  assertSingleScheduledOffset(normalized);
  return normalized;
}

export async function ensureAsaasNotificationPreferences(
  contaId: string,
): Promise<NotificationPreferenceDTO[]> {
  const existing = await prisma.asaasNotificationPreference.findMany({ where: { contaId } });
  const defaults = normalizePreferenceList(DEFAULT_NOTIFICATION_PRESETS);
  const existingKeys = new Set(existing.map(preferenceKey));
  const missing = defaults.filter((preset) => !existingKeys.has(preferenceKey(preset)));
  if (missing.length === 0) return existing.map(toDTO);

  await prisma.asaasNotificationPreference.createMany({
    data: missing.map((preset) => ({ contaId, ...preset })),
    skipDuplicates: true,
  });

  const seeded = await prisma.asaasNotificationPreference.findMany({ where: { contaId } });
  return seeded.map(toDTO);
}

export async function getAsaasNotificationPreferences(
  contaId: string,
): Promise<NotificationPreferenceDTO[]> {
  const prefs = await prisma.asaasNotificationPreference.findMany({ where: { contaId } });
  if (prefs.length === 0) {
    return ensureAsaasNotificationPreferences(contaId);
  }
  return prefs.map(toDTO);
}

export async function saveAsaasNotificationPreferences(
  contaId: string,
  payload: NotificationPreferenceInput[],
  transaction?: Prisma.TransactionClient,
): Promise<NotificationPreferenceDTO[]> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Nenhuma preferência enviada');
  }

  const sanitized = normalizePreferenceList(payload).map((pref) => ({
    contaId,
    ...pref,
  }));

  const save = async (tx: Prisma.TransactionClient) => {
    const selectedScheduledOffsets = new Map<AsaasNotificationEvent, number>();
    sanitized.forEach((preference) => {
      if (!EVENTS_WITH_SCHEDULE_OFFSET.has(preference.event)) return;
      const current = selectedScheduledOffsets.get(preference.event);
      // A positive reminder is the selected reminder when both it and the due-date
      // event are submitted. Offset 0 alone means the positive reminder was removed.
      if (current === undefined || preference.scheduleOffset > 0) selectedScheduledOffsets.set(preference.event, preference.scheduleOffset);
    });
    for (const [event, scheduleOffset] of selectedScheduledOffsets) {
      await tx.asaasNotificationPreference.deleteMany({
        where: {
          contaId,
          event,
          scheduleOffset: scheduleOffset > 0 ? { gt: 0, not: scheduleOffset } : { gt: 0 },
        },
      });
    }
    for (const preference of sanitized) {
      const { contaId: _contaId, event, scheduleOffset, ...data } = preference;
      await tx.asaasNotificationPreference.upsert({
        where: {
          contaId_event_scheduleOffset: { contaId, event, scheduleOffset },
        },
        create: preference,
        update: data,
      });
    }
    return tx.asaasNotificationPreference.findMany({ where: { contaId } });
  };

  const updated = transaction ? await save(transaction) : await prisma.$transaction(save);
  return updated.map(toDTO);
}

export async function getAsaasNotificationPolicy(contaId: string) {
  const [conta, pending, failed, legacyPreferenceUnknown] = await Promise.all([
    prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        customerNotificationsEnabled: true,
        customerEmailNotificationsEnabled: true,
        customerWhatsAppNotificationsEnabled: true,
        customerSmsNotificationsEnabled: true,
        contractWhatsAppNotificationsEnabled: true,
        contractNotificationsEnabled: true,
        contractEmailNotificationsEnabled: true,
        notificationPolicyVersion: true,
      },
    }),
    prisma.asaasNotificationPreferenceOutbox.count({
      where: { contaId, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
    }),
    prisma.asaasNotificationPreferenceOutbox.count({
      where: { contaId, status: { in: ['FAILED', 'EXHAUSTED'] } },
    }),
    prisma.asaasCustomerNotificationOverride.count({ where: { contaId, source: 'LEGACY_UNVERIFIED' } }),
  ]);
  return {
    policy: {
      customerNotificationsEnabled: conta?.customerNotificationsEnabled ?? true,
      customerEmailNotificationsEnabled: conta?.customerEmailNotificationsEnabled ?? true,
      customerWhatsAppNotificationsEnabled: conta?.customerWhatsAppNotificationsEnabled ?? true,
      customerSmsNotificationsEnabled: conta?.customerSmsNotificationsEnabled ?? true,
      contractWhatsAppNotificationsEnabled: conta?.contractWhatsAppNotificationsEnabled ?? true,
      contractNotificationsEnabled: conta?.contractNotificationsEnabled ?? true,
      contractEmailNotificationsEnabled: conta?.contractEmailNotificationsEnabled ?? false,
      version: conta?.notificationPolicyVersion ?? 1,
    },
    synchronization: { pending, failed, legacyPreferenceUnknown },
  };
}

interface RemoteNotification {
  id: string;
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled?: boolean;
  emailEnabledForProvider?: boolean;
  smsEnabledForProvider?: boolean;
  emailEnabledForCustomer?: boolean;
  smsEnabledForCustomer?: boolean;
  whatsappEnabledForCustomer?: boolean;
  phoneCallEnabledForCustomer?: boolean;
  deleted?: boolean;
}

interface NotificationBatchUpdateItem {
  id: string;
  enabled?: boolean;
  emailEnabledForProvider?: boolean;
  smsEnabledForProvider?: boolean;
  emailEnabledForCustomer?: boolean;
  smsEnabledForCustomer?: boolean;
  whatsappEnabledForCustomer?: boolean;
  phoneCallEnabledForCustomer?: boolean;
  scheduleOffset?: number;
}

type NotificationUpdateSource = NotificationChannels & {
  id?: string;
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
};

const EVENTS_WITH_SCHEDULE_OFFSET = new Set<string>(['PAYMENT_DUEDATE_WARNING', 'PAYMENT_OVERDUE']);

async function fetchCustomerNotifications(contaId: string, asaasCustomerId: string) {
  const credentials = await loadDecryptedAsaasCredentials(contaId);
  if (!credentials?.apiKey) throw new Error('Conta sem credenciais Asaas configuradas');

  const baseUrl = getAsaasBaseUrl(credentials.apiKey);
  const response = await fetch(`${baseUrl}/customers/${asaasCustomerId}/notifications`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token: credentials.apiKey,
      'User-Agent': 'Alusa-Platform/1.0',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao consultar notificações do cliente (${response.status}): ${body}`);
  }

  const json = await response.json();
  const data = Array.isArray(json?.data) ? (json.data as RemoteNotification[]) : [];
  return { data, credentials, baseUrl };
}

function remoteToCustomerPreference(
  notification: RemoteNotification,
): CustomerNotificationPreferenceDTO {
  return {
    id: notification.id,
    event: notification.event,
    scheduleOffset: notification.scheduleOffset ?? 0,
    enabled: notification.enabled ?? true,
    customerEnabled: true,
    emailEnabledForProvider: notification.emailEnabledForProvider ?? false,
    smsEnabledForProvider: notification.smsEnabledForProvider ?? false,
    emailEnabledForCustomer: notification.emailEnabledForCustomer ?? true,
    smsEnabledForCustomer: notification.smsEnabledForCustomer ?? true,
    whatsappEnabledForCustomer: notification.whatsappEnabledForCustomer ?? false,
    phoneCallEnabledForCustomer: notification.phoneCallEnabledForCustomer ?? false,
  };
}

function buildCustomerNotificationUpdate(
  input: CustomerNotificationPreferenceInput,
  fallback: RemoteNotification | undefined,
): NotificationBatchUpdateItem {
  if (!fallback) throw new Error(`Notificação ${input.event} com intervalo ${input.scheduleOffset ?? 0} não encontrada no Asaas.`);
  const customerEnabled = input.customerEnabled ?? true;
  const update: NotificationBatchUpdateItem = {
    id: fallback.id,
    emailEnabledForCustomer: customerEnabled && (input.emailEnabledForCustomer ?? fallback.emailEnabledForCustomer ?? true),
    smsEnabledForCustomer: customerEnabled && (input.smsEnabledForCustomer ?? fallback.smsEnabledForCustomer ?? true),
    whatsappEnabledForCustomer: customerEnabled && (input.whatsappEnabledForCustomer ?? fallback.whatsappEnabledForCustomer ?? false),
    phoneCallEnabledForCustomer: customerEnabled && (input.phoneCallEnabledForCustomer ?? fallback.phoneCallEnabledForCustomer ?? false),
  };
  if (EVENTS_WITH_SCHEDULE_OFFSET.has(input.event)) update.scheduleOffset = input.scheduleOffset ?? fallback.scheduleOffset ?? 0;
  return update;
}

function matchRemoteNotification(
  input: CustomerNotificationPreferenceInput,
  remote: RemoteNotification[],
) {
  if (input.id) {
    const byId = remote.find((item) => item.id === input.id);
    if (byId) return byId;
  }

  const scheduleOffset = input.scheduleOffset ?? 0;
  return remote.find(
    (item) => item.event === input.event && (item.scheduleOffset ?? 0) === scheduleOffset,
  );
}

/**
 * Agrupa preferências por evento.
 * Para eventos com scheduleOffset > 0, há duas notificações (ex: PAYMENT_DUEDATE_WARNING com offset 0 e 10).
 * O Asaas mantém os IDs fixos para cada combinação event+offset, então precisamos mapear:
 * - Preferência local com offset > 0 → Notificação remota com offset > 0
 * - Preferência local com offset = 0 → Notificação remota com offset = 0
 */
function buildNotificationUpdates(prefs: NotificationUpdateSource[], remote: RemoteNotification[]) {
  const remoteByEvent = new Map<string, RemoteNotification[]>();
  for (const item of remote) {
    const list = remoteByEvent.get(item.event) || [];
    list.push(item);
    remoteByEvent.set(item.event, list);
  }

  const updates: NotificationBatchUpdateItem[] = [];

  for (const pref of prefs) {
    const remoteList = remoteByEvent.get(pref.event) || [];

    let targetRemote: RemoteNotification | undefined = pref.id
      ? remote.find((item) => item.id === pref.id)
      : undefined;

    if (!targetRemote) {
      targetRemote = remoteList.find((r) => (r.scheduleOffset ?? 0) === pref.scheduleOffset);
    }

    if (!targetRemote) {
      throw new Error(`Notificação ${pref.event} com intervalo ${pref.scheduleOffset} não encontrada no Asaas.`);
    }

    const payload: NotificationBatchUpdateItem = {
      id: targetRemote.id,
      enabled: pref.enabled,
      emailEnabledForProvider: pref.emailEnabledForProvider,
      smsEnabledForProvider: pref.smsEnabledForProvider,
      emailEnabledForCustomer: pref.emailEnabledForCustomer,
      smsEnabledForCustomer: pref.smsEnabledForCustomer,
      whatsappEnabledForCustomer: pref.whatsappEnabledForCustomer,
      phoneCallEnabledForCustomer: pref.phoneCallEnabledForCustomer,
    };

    if (EVENTS_WITH_SCHEDULE_OFFSET.has(pref.event)) {
      payload.scheduleOffset = pref.scheduleOffset;
    }

    updates.push(payload);
  }

  return updates;
}

function updateWithoutId(update: NotificationBatchUpdateItem) {
  const { id: _id, ...body } = update;
  return body;
}

async function readAsaasErrors(response: Response) {
  const payload = await response.json().catch(() => null);
  if (Array.isArray(payload?.errors)) {
    return payload.errors as Array<{ code?: string; description?: string }>;
  }
  return [];
}

export async function getAsaasCustomerNotificationPreferences(
  contaId: string,
  asaasCustomerId: string,
): Promise<CustomerNotificationPreferenceDTO[]> {
  const { data } = await fetchCustomerNotifications(contaId, asaasCustomerId);
  const [globalPreferences, overrides, policy] = await Promise.all([
    getAsaasNotificationPreferences(contaId),
    prisma.asaasCustomerNotificationOverride.findMany({ where: { contaId, asaasCustomerId } }),
    prisma.conta.findUnique({ where: { id: contaId }, select: { customerNotificationsEnabled: true, customerEmailNotificationsEnabled: true, customerWhatsAppNotificationsEnabled: true, customerSmsNotificationsEnabled: true } }),
  ]);
  return data.filter((notification) => notification.deleted !== true).map((notification) => {
    const remote = remoteToCustomerPreference(notification);
    const global = globalPreferences.find((item) => item.event === remote.event && item.scheduleOffset === remote.scheduleOffset);
    const override = overrides.find((item) => item.event === remote.event && item.scheduleOffset === remote.scheduleOffset);
    const customerEnabled = override?.customerEnabled ?? global?.customerEnabled ?? true;
    const inheritedEnabled = policy?.customerNotificationsEnabled ?? true;
    return {
      ...remote,
      customerEnabled,
      emailEnabledForCustomer: inheritedEnabled && (policy?.customerEmailNotificationsEnabled ?? true) && customerEnabled ? override?.emailEnabledForCustomer ?? (remote.emailEnabledForCustomer ? global?.emailEnabledForCustomer ?? true : false) : false,
      smsEnabledForCustomer: inheritedEnabled && (policy?.customerSmsNotificationsEnabled ?? true) && customerEnabled ? override?.smsEnabledForCustomer ?? (remote.smsEnabledForCustomer ? global?.smsEnabledForCustomer ?? true : false) : false,
      whatsappEnabledForCustomer: inheritedEnabled && (policy?.customerWhatsAppNotificationsEnabled ?? true) && customerEnabled ? override?.whatsappEnabledForCustomer ?? (remote.whatsappEnabledForCustomer ? global?.whatsappEnabledForCustomer ?? true : false) : false,
      phoneCallEnabledForCustomer: inheritedEnabled && customerEnabled ? override?.phoneCallEnabledForCustomer ?? (remote.phoneCallEnabledForCustomer ? global?.phoneCallEnabledForCustomer ?? true : false) : false,
    };
  });
}

async function verifyRemoteNotificationUpdates(
  contaId: string,
  asaasCustomerId: string,
  updates: NotificationBatchUpdateItem[],
) {
  // Confirm the provider's persisted response before overlays from local policy/overrides.
  // A local opt-in must never make an ignored Asaas PUT look successful.
  const { data: verified } = await fetchCustomerNotifications(contaId, asaasCustomerId);
  for (const update of updates) {
    const actual = verified.find((notification) => notification.id === update.id);
    if (!actual) throw new Error('Notificação não encontrada após a sincronização no Asaas.');
    const rawActual = actual as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(update)) {
      if (key !== 'id' && value !== rawActual[key]) {
        throw new Error('A configuração de notificações não foi confirmada pelo Asaas.');
      }
    }
  }
  return verified.map(remoteToCustomerPreference);
}

async function persistLegacyRemoteOptOuts(
  contaId: string,
  asaasCustomerId: string,
  notifications: RemoteNotification[],
  knownOverrides: Array<{ event: AsaasNotificationEvent; scheduleOffset: number }>,
) {
  const known = new Set(knownOverrides.map((override) => `${override.event}:${override.scheduleOffset}`));
  const legacy = notifications.filter((notification) => {
    const key = `${notification.event}:${notification.scheduleOffset ?? 0}`;
    return !known.has(key) && [
      notification.emailEnabledForCustomer,
      notification.smsEnabledForCustomer,
      notification.whatsappEnabledForCustomer,
      notification.phoneCallEnabledForCustomer,
    ].some((enabled) => enabled === false);
  });
  if (!legacy.length) return;
  await prisma.$transaction(async (tx) => {
    for (const notification of legacy) {
      const scheduleOffset = notification.scheduleOffset ?? 0;
      await tx.asaasCustomerNotificationOverride.upsert({
        where: { uq_asaas_customer_notification_override: { contaId, asaasCustomerId, event: notification.event, scheduleOffset } },
        create: {
          contaId, asaasCustomerId, event: notification.event, scheduleOffset,
          customerEnabled: null,
          emailEnabledForCustomer: notification.emailEnabledForCustomer === false ? false : null,
          smsEnabledForCustomer: notification.smsEnabledForCustomer === false ? false : null,
          whatsappEnabledForCustomer: notification.whatsappEnabledForCustomer === false ? false : null,
          phoneCallEnabledForCustomer: notification.phoneCallEnabledForCustomer === false ? false : null,
          source: 'LEGACY_UNVERIFIED',
        },
        update: {},
      });
    }
  });
}

export async function saveAsaasCustomerNotificationPreferences(
  contaId: string,
  asaasCustomerId: string,
  payload: CustomerNotificationPreferenceInput[],
): Promise<CustomerNotificationPreferenceDTO[]> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Nenhuma preferência enviada');
  }

  const { data, credentials, baseUrl } = await fetchCustomerNotifications(contaId, asaasCustomerId);
  const activeNotifications = data.filter((notification) => notification.deleted !== true);
  const accountPolicy = await prisma.conta.findUnique({
    where: { id: contaId },
    select: {
      customerNotificationsEnabled: true,
      customerEmailNotificationsEnabled: true,
      customerWhatsAppNotificationsEnabled: true,
      customerSmsNotificationsEnabled: true,
    },
  });
  const customerUpdateInputs = payload.map((input) => {
    const matching = matchRemoteNotification(input, activeNotifications);
    return { input, matching, update: buildCustomerNotificationUpdate(input, matching) };
  });
  const updates = customerUpdateInputs.map(({ update }) => ({
    ...update,
    emailEnabledForCustomer: (accountPolicy?.customerNotificationsEnabled ?? true) && (accountPolicy?.customerEmailNotificationsEnabled ?? true) && update.emailEnabledForCustomer,
    smsEnabledForCustomer: (accountPolicy?.customerNotificationsEnabled ?? true) && (accountPolicy?.customerSmsNotificationsEnabled ?? true) && update.smsEnabledForCustomer,
    whatsappEnabledForCustomer: (accountPolicy?.customerNotificationsEnabled ?? true) && (accountPolicy?.customerWhatsAppNotificationsEnabled ?? true) && update.whatsappEnabledForCustomer,
    phoneCallEnabledForCustomer: (accountPolicy?.customerNotificationsEnabled ?? true) && update.phoneCallEnabledForCustomer,
  }));

  if (updates.length === 0) {
    return activeNotifications.map(remoteToCustomerPreference);
  }

  if (!credentials.apiKey) {
    throw new Error('Conta sem credenciais Asaas configuradas');
  }

  const headers = {
    'Content-Type': 'application/json',
    access_token: credentials.apiKey,
    'User-Agent': 'Alusa-Platform/1.0',
  };

  // Persist the customer's explicit choice and a retryable sync intent before
  // calling Asaas. If the provider accepts the PUT and any later step fails,
  // the local choice remains authoritative input for the outbox reconciler.
  const claimToken = randomUUID();
  const synchronousClaim = await prisma.$transaction(async (tx) => {
    const conta = await tx.conta.update({
      where: { id: contaId },
      data: { notificationPolicyVersion: { increment: 1 } },
      select: { notificationPolicyVersion: true },
    });
    for (const { input, matching } of customerUpdateInputs) {
      const scheduleOffset = input.scheduleOffset ?? matching?.scheduleOffset ?? 0;
      await tx.asaasCustomerNotificationOverride.upsert({
        where: { uq_asaas_customer_notification_override: { contaId, asaasCustomerId, event: input.event, scheduleOffset } },
        create: {
          contaId, asaasCustomerId, event: input.event, scheduleOffset,
          customerEnabled: input.customerEnabled ?? true,
          emailEnabledForCustomer: input.emailEnabledForCustomer ?? null,
          smsEnabledForCustomer: input.smsEnabledForCustomer ?? null,
          whatsappEnabledForCustomer: input.whatsappEnabledForCustomer ?? null,
          phoneCallEnabledForCustomer: input.phoneCallEnabledForCustomer ?? null,
          source: 'EXPLICIT',
        },
        update: {
          customerEnabled: input.customerEnabled ?? true,
          source: 'EXPLICIT',
          ...(input.emailEnabledForCustomer === undefined ? {} : { emailEnabledForCustomer: input.emailEnabledForCustomer }),
          ...(input.smsEnabledForCustomer === undefined ? {} : { smsEnabledForCustomer: input.smsEnabledForCustomer }),
          ...(input.whatsappEnabledForCustomer === undefined ? {} : { whatsappEnabledForCustomer: input.whatsappEnabledForCustomer }),
          ...(input.phoneCallEnabledForCustomer === undefined ? {} : { phoneCallEnabledForCustomer: input.phoneCallEnabledForCustomer }),
        },
      });
    }
    const dedupeKey = `tenant-preferences:${asaasCustomerId}`;
    const existingOutbox = await tx.asaasNotificationPreferenceOutbox.findUnique({
      where: { uq_asaas_notif_outbox_conta_dedupe: { contaId, dedupeKey } },
      select: { status: true },
    });
    await tx.asaasNotificationPreferenceOutbox.upsert({
      where: { uq_asaas_notif_outbox_conta_dedupe: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}` } },
      create: {
        contaId, asaasCustomerId, dedupeKey: `tenant-preferences:${asaasCustomerId}`,
        reason: 'CUSTOMER_NOTIFICATION_OVERRIDE_UPDATED', policyVersion: conta.notificationPolicyVersion,
      },
      update: {
        ...(existingOutbox?.status === 'PROCESSING' ? {} : {
          status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), processingAt: null, claimToken: null,
          processedAt: null, lastError: null, lastErrorAt: null,
        }),
        reason: 'CUSTOMER_NOTIFICATION_OVERRIDE_UPDATED', policyVersion: conta.notificationPolicyVersion,
      },
    });
    const claim = await tx.asaasNotificationPreferenceOutbox.updateMany({
      where: { contaId, dedupeKey, status: 'PENDING', policyVersion: conta.notificationPolicyVersion },
      data: { status: 'PROCESSING', processingAt: new Date(), claimToken, attempts: { increment: 1 } },
    });
    return { claimed: claim.count > 0, policyVersion: conta.notificationPolicyVersion };
  });

  // A queue worker (or another synchronous save) already owns this customer's
  // row. Leave the newest intent queued; never issue a competing remote PUT.
  if (!synchronousClaim.claimed) throw new Error('Preferências salvas; sincronização já está em andamento.');

  try {
  const batchResponse = await fetch(`${baseUrl}/notifications/batch`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      customer: asaasCustomerId,
      notifications: updates,
    }),
  });

  if (!batchResponse.ok) {
    const errors = await readAsaasErrors(batchResponse);
    let failed = 0;

    for (const update of updates) {
      const response = await fetch(`${baseUrl}/notifications/${update.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updateWithoutId(update)),
      });

      if (!response.ok) {
        failed++;
      }
    }

    if (failed > 0) {
      const firstError =
        errors[0]?.description || errors[0]?.code || 'Falha ao atualizar notificações';
      throw new Error(firstError);
    }
  }

  const verified = await verifyRemoteNotificationUpdates(contaId, asaasCustomerId, updates);
  const completed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
    where: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}`, status: 'PROCESSING', claimToken, policyVersion: synchronousClaim.policyVersion },
    data: { status: 'DONE', processingAt: null, claimToken: null, processedAt: new Date(), lastAppliedPolicyVersion: synchronousClaim.policyVersion, lastError: null, lastErrorAt: null },
  });
  if (completed.count === 0) {
    await prisma.asaasNotificationPreferenceOutbox.updateMany({
      where: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}`, status: 'PROCESSING', claimToken, policyVersion: { not: synchronousClaim.policyVersion } },
      data: { status: 'PENDING', processingAt: null, claimToken: null, nextAttemptAt: new Date() },
    });
  }
  return verified;
  } catch (error) {
    const failed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
      where: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}`, status: 'PROCESSING', claimToken, policyVersion: synchronousClaim.policyVersion },
      data: { status: 'FAILED', processingAt: null, claimToken: null, nextAttemptAt: new Date(), lastError: error instanceof Error ? error.message : String(error), lastErrorAt: new Date() },
    });
    if (failed.count === 0) {
      await prisma.asaasNotificationPreferenceOutbox.updateMany({
        where: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}`, status: 'PROCESSING', claimToken, policyVersion: { not: synchronousClaim.policyVersion } },
        data: { status: 'PENDING', processingAt: null, claimToken: null, nextAttemptAt: new Date() },
      });
    }
    throw error;
  }
}

export async function applyAsaasNotificationPreferencesToCustomer(
  contaId: string,
  asaasCustomerId: string,
): Promise<{ updated: boolean; total?: number }> {
  const tenantPrefs = await loadTenantNotificationEventPreferences(contaId);
  const prefs =
    tenantPrefs.length > 0
      ? tenantPrefs
      : (await getAsaasNotificationPreferences(contaId)).map((pref) => ({
          event: pref.event,
          scheduleOffset: pref.scheduleOffset,
          enabled: pref.enabled,
          customerEnabled: pref.customerEnabled,
          emailEnabledForProvider: pref.emailEnabledForProvider,
          smsEnabledForProvider: pref.smsEnabledForProvider,
          emailEnabledForCustomer: pref.emailEnabledForCustomer,
          smsEnabledForCustomer: pref.smsEnabledForCustomer,
          whatsappEnabledForCustomer: pref.whatsappEnabledForCustomer,
          phoneCallEnabledForCustomer: pref.phoneCallEnabledForCustomer,
        }));

  const [accountPolicy, overrides] = await Promise.all([
    prisma.conta.findUnique({ where: { id: contaId }, select: { customerNotificationsEnabled: true, customerEmailNotificationsEnabled: true, customerWhatsAppNotificationsEnabled: true, customerSmsNotificationsEnabled: true } }),
    prisma.asaasCustomerNotificationOverride.findMany({ where: { contaId, asaasCustomerId } }),
  ]);
  const syncState = await prisma.asaasNotificationPreferenceOutbox.findUnique({
    where: { uq_asaas_notif_outbox_conta_dedupe: { contaId, dedupeKey: `tenant-preferences:${asaasCustomerId}` } },
    select: { lastAppliedPolicyVersion: true },
  });
  const preserveLegacyRemoteOptOuts = syncState?.lastAppliedPolicyVersion == null;
  const customerNotificationsEnabled = accountPolicy?.customerNotificationsEnabled ?? true;
  const { data, credentials, baseUrl } = await fetchCustomerNotifications(contaId, asaasCustomerId);

  if (!credentials.apiKey) {
    throw new Error('Conta sem credenciais Asaas configuradas');
  }

  const activeNotifications = data.filter((notification) => notification.deleted !== true);
  const updates = buildNotificationUpdates(prefs, activeNotifications).map((update) => {
    const current = activeNotifications.find((notification) => notification.id === update.id);
    const preference = prefs.find((item) => item.event === current?.event && item.scheduleOffset === current?.scheduleOffset);
    const override = overrides.find((item) => item.event === current?.event && item.scheduleOffset === current?.scheduleOffset);
    const recipientAllowed = customerNotificationsEnabled && (override?.customerEnabled ?? preference?.customerEnabled ?? true);
    const canInheritRemoteChannel = (value: boolean | undefined) => !preserveLegacyRemoteOptOuts || value !== false;
    return {
      ...update,
      emailEnabledForCustomer: recipientAllowed && (override?.emailEnabledForCustomer ?? (canInheritRemoteChannel(current?.emailEnabledForCustomer) && (accountPolicy?.customerEmailNotificationsEnabled ?? preference?.emailEnabledForCustomer ?? update.emailEnabledForCustomer))),
      smsEnabledForCustomer: recipientAllowed && (override?.smsEnabledForCustomer ?? (canInheritRemoteChannel(current?.smsEnabledForCustomer) && (accountPolicy?.customerSmsNotificationsEnabled ?? preference?.smsEnabledForCustomer ?? update.smsEnabledForCustomer))),
      whatsappEnabledForCustomer: recipientAllowed && (override?.whatsappEnabledForCustomer ?? (canInheritRemoteChannel(current?.whatsappEnabledForCustomer) && (accountPolicy?.customerWhatsAppNotificationsEnabled ?? preference?.whatsappEnabledForCustomer ?? update.whatsappEnabledForCustomer))),
      phoneCallEnabledForCustomer: recipientAllowed && (override?.phoneCallEnabledForCustomer ?? (canInheritRemoteChannel(current?.phoneCallEnabledForCustomer) && (preference?.phoneCallEnabledForCustomer ?? update.phoneCallEnabledForCustomer))),
    };
  });
  const configuredScheduledEvents = new Map<AsaasNotificationEvent, number>();
  for (const preference of prefs) {
    if (!EVENTS_WITH_SCHEDULE_OFFSET.has(preference.event)) continue;
    const selected = configuredScheduledEvents.get(preference.event);
    if (selected === undefined || preference.scheduleOffset > 0) configuredScheduledEvents.set(preference.event, preference.scheduleOffset);
  }
  for (const [event, scheduleOffset] of configuredScheduledEvents) {
    const selected = scheduleOffset > 0 ? activeNotifications.find(
      (notification) => notification.event === event && notification.scheduleOffset === scheduleOffset,
    ) : undefined;
    if (scheduleOffset > 0 && !selected) throw new Error(`Intervalo ${scheduleOffset} de ${event} não existe no Asaas.`);
    if (selected && !updates.some((update) => update.id === selected.id)) throw new Error(`Intervalo ${scheduleOffset} de ${event} não foi incluído na sincronização.`);
    for (const other of activeNotifications) {
      if (other.event !== event || other.scheduleOffset <= 0 || other.id === selected?.id) continue;
      if (!updates.some((update) => update.id === other.id)) updates.push({
        id: other.id,
        emailEnabledForCustomer: false,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false,
        phoneCallEnabledForCustomer: false,
      });
    }
  }
  if (updates.length === 0) return { updated: false };

  const apiKey = credentials.apiKey;
  const headers = {
    'Content-Type': 'application/json',
    access_token: apiKey,
    'User-Agent': 'Alusa-Platform/1.0',
  };

  const batchResponse = await fetch(`${baseUrl}/notifications/batch`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      customer: asaasCustomerId,
      notifications: updates,
    }),
  });

  if (batchResponse.ok) {
    await batchResponse.json().catch(() => null);
    // The batch response is not the source of truth; verify the persisted state.
    const verified = await verifyRemoteNotificationUpdates(contaId, asaasCustomerId, updates);
    if (preserveLegacyRemoteOptOuts) {
      await persistLegacyRemoteOptOuts(contaId, asaasCustomerId, activeNotifications, overrides);
    }
    return { updated: true, total: verified.length || updates.length };
  }

  await batchResponse.text().catch(() => '');
  logFinanceOperationalEvent({
    severity: 'error',
    eventName: 'finance.services.asaas_notification_preferences_service.failed',
    throttleMs: 60_000,
  });

  let successCount = 0;
  for (const update of updates) {
    const response = await fetch(`${baseUrl}/notifications/${update.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(update),
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.services.asaas_notification_preferences_service.failed',
        throttleMs: 60_000,
      });
      continue;
    }

    successCount++;
  }

  const verified = await verifyRemoteNotificationUpdates(contaId, asaasCustomerId, updates);
  if (preserveLegacyRemoteOptOuts) {
    await persistLegacyRemoteOptOuts(contaId, asaasCustomerId, activeNotifications, overrides);
  }
  return { updated: successCount > 0, total: verified.length };
}

export async function listCustomerIdsWithAsaas(contaId: string, transaction?: Prisma.TransactionClient): Promise<string[]> {
  const db = transaction ?? prisma;
  const ids = new Set<string>();
  const pageSize = 500;
  let cursor: string | undefined;
  do {
    const afterId = cursor;
    const page: Array<{ id: string; asaasCustomerId: string | null }> = await db.customer.findMany({
      where: { contaId, asaasCustomerId: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, asaasCustomerId: true }, orderBy: { id: 'asc' }, take: pageSize,
    });
    page.forEach((customer) => customer.asaasCustomerId && ids.add(customer.asaasCustomerId));
    cursor = page.length === pageSize ? page.at(-1)?.id : undefined;
  } while (cursor);

  cursor = undefined;
  do {
    const afterId = cursor;
    const page: Array<{ id: string; asaasCustomerId: string | null }> = await db.aluno.findMany({
      where: { contaId, asaasCustomerId: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, asaasCustomerId: true }, orderBy: { id: 'asc' }, take: pageSize,
    });
    page.forEach((aluno) => aluno.asaasCustomerId && ids.add(aluno.asaasCustomerId));
    cursor = page.length === pageSize ? page.at(-1)?.id : undefined;
  } while (cursor);

  cursor = undefined;
  do {
    const afterId = cursor;
    const page: Array<{ id: string; responsavelFinanceiro: { asaasCustomerId: string | null } | null }> = await db.matricula.findMany({
      where: { contaId, responsavelFinanceiroId: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, responsavelFinanceiro: { select: { asaasCustomerId: true } } },
      orderBy: { id: 'asc' }, take: pageSize,
    });
    page.forEach((matricula) => matricula.responsavelFinanceiro?.asaasCustomerId && ids.add(matricula.responsavelFinanceiro.asaasCustomerId));
    cursor = page.length === pageSize ? page.at(-1)?.id : undefined;
  } while (cursor);
  return Array.from(ids);
}

export async function applyPreferencesToAllCustomers(contaId: string) {
  const customerIds = await listCustomerIdsWithAsaas(contaId);
  const results = { processed: customerIds.length, successes: 0, failures: 0 };
  const errors: Array<{ customerId: string; message: string }> = [];

  for (const customerId of customerIds) {
    try {
      await applyAsaasNotificationPreferencesToCustomer(contaId, customerId);
      results.successes += 1;
    } catch (error) {
      results.failures += 1;
      errors.push({
        customerId,
        message: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  return { ...results, errors };
}
