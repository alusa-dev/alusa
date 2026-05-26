import type {
  AsaasNotificationEvent,
  AsaasNotificationPreference,
} from '@prisma/client';
import { getAsaasBaseUrlForApiKeyOrThrow } from '@alusa/asaas';
import { decryptSecret, prisma } from '@alusa/database';
import { loadTenantNotificationEventPreferences } from '@alusa/lib';

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
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferenceInput = Partial<NotificationChannels> & {
  event: AsaasNotificationEvent;
  scheduleOffset?: number;
  enabled?: boolean;
};

export type CustomerNotificationPreferenceDTO = NotificationChannels & {
  id: string;
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
};

export type CustomerNotificationPreferenceInput = Partial<NotificationChannels> & {
  id?: string;
  event: AsaasNotificationEvent;
  scheduleOffset?: number;
  enabled?: boolean;
};

const DEFAULT_NOTIFICATION_PRESETS: NotificationPreferenceInput[] = [
  {
    event: 'PAYMENT_CREATED',
    scheduleOffset: 0,
    enabled: true,
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
};

function preferenceKey(input: { event: AsaasNotificationEvent; scheduleOffset: number }) {
  return `${input.event}:${input.scheduleOffset}`;
}

function sanitizeInput(input: NotificationPreferenceInput): SanitizedPreference {
  return {
    event: input.event,
    scheduleOffset: input.scheduleOffset ?? 0,
    enabled: input.enabled ?? true,
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

  return [...byKey.values()];
}

export async function ensureAsaasNotificationPreferences(
  contaId: string,
): Promise<NotificationPreferenceDTO[]> {
  const existing = await prisma.asaasNotificationPreference.findMany({ where: { contaId } });
  if (existing.length > 0) return existing.map(toDTO);

  const defaults = normalizePreferenceList(DEFAULT_NOTIFICATION_PRESETS);

  await prisma.asaasNotificationPreference.createMany({
    data: defaults.map((preset) => ({
      contaId,
      ...preset,
    })),
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
): Promise<NotificationPreferenceDTO[]> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('Nenhuma preferência enviada');
  }

  const sanitized = normalizePreferenceList(payload).map((pref) => ({
    contaId,
    ...pref,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.asaasNotificationPreference.deleteMany({ where: { contaId } });
    await tx.asaasNotificationPreference.createMany({ data: sanitized });
  });

  const updated = await prisma.asaasNotificationPreference.findMany({ where: { contaId } });
  return updated.map(toDTO);
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

const EVENTS_WITH_SCHEDULE_OFFSET = new Set<string>([
  'PAYMENT_DUEDATE_WARNING',
  'PAYMENT_OVERDUE',
]);

async function fetchCustomerNotifications(
  contaId: string,
  asaasCustomerId: string,
) {
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
    emailEnabledForProvider: notification.emailEnabledForProvider ?? false,
    smsEnabledForProvider: notification.smsEnabledForProvider ?? false,
    emailEnabledForCustomer: notification.emailEnabledForCustomer ?? true,
    smsEnabledForCustomer: notification.smsEnabledForCustomer ?? true,
    whatsappEnabledForCustomer: notification.whatsappEnabledForCustomer ?? false,
    phoneCallEnabledForCustomer: notification.phoneCallEnabledForCustomer ?? false,
  };
}

function sanitizeCustomerNotificationInput(
  input: CustomerNotificationPreferenceInput,
  fallback?: RemoteNotification,
): NotificationUpdateSource {
  return {
    id: input.id ?? fallback?.id,
    event: input.event,
    scheduleOffset: input.scheduleOffset ?? fallback?.scheduleOffset ?? 0,
    enabled: input.enabled ?? fallback?.enabled ?? true,
    emailEnabledForProvider:
      input.emailEnabledForProvider ?? fallback?.emailEnabledForProvider ?? false,
    smsEnabledForProvider:
      input.smsEnabledForProvider ?? fallback?.smsEnabledForProvider ?? false,
    emailEnabledForCustomer:
      input.emailEnabledForCustomer ?? fallback?.emailEnabledForCustomer ?? true,
    smsEnabledForCustomer:
      input.smsEnabledForCustomer ?? fallback?.smsEnabledForCustomer ?? true,
    whatsappEnabledForCustomer:
      input.whatsappEnabledForCustomer ?? fallback?.whatsappEnabledForCustomer ?? false,
    phoneCallEnabledForCustomer:
      input.phoneCallEnabledForCustomer ?? fallback?.phoneCallEnabledForCustomer ?? false,
  };
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
  const sameEvent = remote.filter((item) => item.event === input.event);
  if (scheduleOffset > 0) {
    return sameEvent.find((item) => item.scheduleOffset > 0);
  }
  return sameEvent.find((item) => (item.scheduleOffset ?? 0) === 0);
}

/**
 * Agrupa preferências por evento.
 * Para eventos com scheduleOffset > 0, há duas notificações (ex: PAYMENT_DUEDATE_WARNING com offset 0 e 10).
 * O Asaas mantém os IDs fixos para cada combinação event+offset, então precisamos mapear:
 * - Preferência local com offset > 0 → Notificação remota com offset > 0
 * - Preferência local com offset = 0 → Notificação remota com offset = 0
 */
function buildNotificationUpdates(
  prefs: NotificationUpdateSource[],
  remote: RemoteNotification[],
) {
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

    if (!targetRemote && pref.scheduleOffset > 0) {
      targetRemote = remoteList.find(r => r.scheduleOffset > 0);
    } else if (!targetRemote) {
      targetRemote = remoteList.find(r => r.scheduleOffset === 0);
    }

    if (!targetRemote) continue;

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

function shouldRetryWithoutWhatsapp(errors: Array<{ code?: string; description?: string }>) {
  return errors.some((error) => {
    const description = String(error.description ?? '').toLowerCase();
    return (
      error.code === 'invalid_action' &&
      (description.includes('whatsapp') ||
        description.includes('evento inválido') ||
        description.includes('telefone') ||
        description.includes('celular') ||
        description.includes('phone') ||
        description.includes('mobile'))
    );
  });
}

export async function getAsaasCustomerNotificationPreferences(
  contaId: string,
  asaasCustomerId: string,
): Promise<CustomerNotificationPreferenceDTO[]> {
  const { data } = await fetchCustomerNotifications(contaId, asaasCustomerId);
  return data
    .filter((notification) => notification.deleted !== true)
    .map(remoteToCustomerPreference);
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
  const updates = buildNotificationUpdates(
    payload.map((input) =>
      sanitizeCustomerNotificationInput(input, matchRemoteNotification(input, activeNotifications)),
    ),
    activeNotifications,
  );

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
      let response = await fetch(`${baseUrl}/notifications/${update.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updateWithoutId(update)),
      });

      if (
        !response.ok &&
        update.whatsappEnabledForCustomer &&
        shouldRetryWithoutWhatsapp(await readAsaasErrors(response))
      ) {
        response = await fetch(`${baseUrl}/notifications/${update.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(updateWithoutId({ ...update, whatsappEnabledForCustomer: false })),
        });
      }

      if (!response.ok) {
        failed++;
      }
    }

    if (failed > 0) {
      const firstError = errors[0]?.description || errors[0]?.code || 'Falha ao atualizar notificações';
      throw new Error(firstError);
    }
  }

  return getAsaasCustomerNotificationPreferences(contaId, asaasCustomerId);
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
          emailEnabledForProvider: pref.emailEnabledForProvider,
          smsEnabledForProvider: pref.smsEnabledForProvider,
          emailEnabledForCustomer: pref.emailEnabledForCustomer,
          smsEnabledForCustomer: pref.smsEnabledForCustomer,
          whatsappEnabledForCustomer: pref.whatsappEnabledForCustomer,
          phoneCallEnabledForCustomer: pref.phoneCallEnabledForCustomer,
        }));

  const { data, credentials, baseUrl } = await fetchCustomerNotifications(contaId, asaasCustomerId);

  if (!credentials.apiKey) {
    throw new Error('Conta sem credenciais Asaas configuradas');
  }

  const updates = buildNotificationUpdates(prefs, data);
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
    const json = await batchResponse.json().catch(() => null);
    const notifications = Array.isArray(json?.notifications) ? json.notifications : [];
    return { updated: true, total: notifications.length || updates.length };
  }

  const batchBody = await batchResponse.text().catch(() => '');
  console.error('[Asaas Notifications] Falha no lote, iniciando fallback unitário', {
    customerId: asaasCustomerId,
    status: batchResponse.status,
    body: batchBody,
  });

  let successCount = 0;
  for (const update of updates) {
    const response = await fetch(`${baseUrl}/notifications/${update.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(update),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[Asaas Notifications] Falha ao atualizar ${update.id}: ${body}`);
      continue;
    }

    successCount++;
  }

  return { updated: successCount > 0, total: successCount };
}

export async function listCustomerIdsWithAsaas(contaId: string): Promise<string[]> {
  // Busca alunos com asaasCustomerId da conta
  const alunos = await prisma.aluno.findMany({
    where: { contaId, asaasCustomerId: { not: null } },
    select: { asaasCustomerId: true },
  });

  // Busca responsáveis financeiros das matrículas de alunos da conta
  const matriculas = await prisma.matricula.findMany({
    where: {
      aluno: { contaId },
      responsavelFinanceiroId: { not: null },
    },
    select: {
      responsavelFinanceiro: {
        select: { asaasCustomerId: true },
      },
    },
  });

  const ids = new Set<string>();
  alunos.forEach((a) => a.asaasCustomerId && ids.add(a.asaasCustomerId));
  matriculas.forEach((m) => m.responsavelFinanceiro?.asaasCustomerId && ids.add(m.responsavelFinanceiro.asaasCustomerId));
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
