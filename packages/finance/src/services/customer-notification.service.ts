/**
 * Customer Notification Service
 * 
 * Gerencia sincronização de canais de notificação do cliente no Asaas.
 * Implementa política "best-effort com degradação controlada":
 * - Tenta aplicar preferências do usuário
 * - Se WhatsApp falhar para certos eventos (invalid_action), faz fallback
 * - Nunca bloqueia o fluxo principal (criação de cobrança)
 */

import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { AsaasNotificationEvent } from '@prisma/client';

// =============================================================================
// Types
// =============================================================================

export interface NotificationChannelPreferences {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
}

export interface NotificationEventPreference {
  event: AsaasNotificationEvent | string;
  scheduleOffset: number;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
}

export interface SyncNotificationOptions {
  eventPreferences?: NotificationEventPreference[];
}

export interface NotificationWarning {
  notificationId: string;
  event: string;
  channel: 'email' | 'sms' | 'whatsapp';
  code: string;
  message: string;
}

export interface SyncNotificationResult {
  success: boolean;
  applied: NotificationChannelPreferences;
  warnings: NotificationWarning[];
}

export interface CustomerNotificationChannelsSnapshot {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  notificationCount: number;
}

interface AsaasNotification {
  id: string;
  event: string;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
  scheduleOffset: number;
  deleted?: boolean;
}

interface AsaasNotificationUpdate {
  id: string;
  enabled?: boolean;
  emailEnabledForProvider?: boolean;
  smsEnabledForProvider?: boolean;
  emailEnabledForCustomer?: boolean;
  smsEnabledForCustomer?: boolean;
  whatsappEnabledForCustomer?: boolean;
  phoneCallEnabledForCustomer?: boolean;
}

type DesiredNotificationChannels = Required<Omit<AsaasNotificationUpdate, 'id'>>;

type NotificationUpdateTask = {
  notification: AsaasNotification;
  desired: DesiredNotificationChannels;
  update: AsaasNotificationUpdate;
};

type AsaasError = {
  code: string;
  description: string;
};

// =============================================================================
// Helpers
// =============================================================================

const WHATSAPP_UNSUPPORTED_EVENTS = new Set(['SEND_LINHA_DIGITAVEL']);

function buildAsaasUrl(apiKey: string): string {
  const envUrl = (process.env.ASAAS_BASE_URL ?? '').trim();
  if (envUrl) return envUrl;
  const isSandbox = apiKey.includes('hmlg');
  return isSandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
}

function isSandboxBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('api-sandbox') || baseUrl.includes('sandbox');
}

function capabilityKey(event: string, scheduleOffset: number): string {
  return `${event}:${scheduleOffset}`;
}

function supportsWhatsappForEvent(event: string): boolean {
  return !WHATSAPP_UNSUPPORTED_EVENTS.has(event);
}

function toEventPreferenceMap(eventPreferences?: NotificationEventPreference[]) {
  return new Map(
    (eventPreferences ?? []).map((pref) => [
      capabilityKey(pref.event, pref.scheduleOffset),
      pref,
    ]),
  );
}

function resolveDesiredChannels(
  notification: AsaasNotification,
  preferences: NotificationChannelPreferences,
  eventPreferences: Map<string, NotificationEventPreference>,
  sandboxEnv: boolean,
): DesiredNotificationChannels {
  const eventPreference = eventPreferences.get(
    capabilityKey(notification.event, notification.scheduleOffset),
  );

  const whatsappSupported = supportsWhatsappForEvent(notification.event);

  if (eventPreference) {
    return {
      enabled: eventPreference.enabled,
      emailEnabledForProvider: eventPreference.emailEnabledForProvider,
      smsEnabledForProvider: eventPreference.smsEnabledForProvider,
      emailEnabledForCustomer: eventPreference.emailEnabledForCustomer,
      smsEnabledForCustomer: eventPreference.smsEnabledForCustomer,
      whatsappEnabledForCustomer:
        eventPreference.whatsappEnabledForCustomer && whatsappSupported && !sandboxEnv,
      phoneCallEnabledForCustomer: eventPreference.phoneCallEnabledForCustomer,
    };
  }

  return {
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: preferences.email,
    smsEnabledForCustomer: preferences.sms,
    whatsappEnabledForCustomer: preferences.whatsapp && whatsappSupported && !sandboxEnv,
    phoneCallEnabledForCustomer: false,
  };
}

function needsUpdate(
  current: AsaasNotification,
  desired: DesiredNotificationChannels,
): boolean {
  return (
    current.enabled !== desired.enabled ||
    current.emailEnabledForProvider !== desired.emailEnabledForProvider ||
    current.smsEnabledForProvider !== desired.smsEnabledForProvider ||
    current.emailEnabledForCustomer !== desired.emailEnabledForCustomer ||
    current.smsEnabledForCustomer !== desired.smsEnabledForCustomer ||
    current.whatsappEnabledForCustomer !== desired.whatsappEnabledForCustomer ||
    current.phoneCallEnabledForCustomer !== desired.phoneCallEnabledForCustomer
  );
}

function buildUpdatePayload(
  notification: AsaasNotification,
  desired: DesiredNotificationChannels,
): AsaasNotificationUpdate {
  return {
    id: notification.id,
    enabled: desired.enabled,
    emailEnabledForProvider: desired.emailEnabledForProvider,
    smsEnabledForProvider: desired.smsEnabledForProvider,
    emailEnabledForCustomer: desired.emailEnabledForCustomer,
    smsEnabledForCustomer: desired.smsEnabledForCustomer,
    whatsappEnabledForCustomer: desired.whatsappEnabledForCustomer,
    phoneCallEnabledForCustomer: desired.phoneCallEnabledForCustomer,
  };
}

function getAppliedFromTasks(
  tasks: NotificationUpdateTask[],
  existingNotifications: Array<{ desired: DesiredNotificationChannels }>
): NotificationChannelPreferences {
  const allDesired = [...tasks.map((task) => task.desired), ...existingNotifications.map((item) => item.desired)];

  return {
    email: allDesired.some((desired) => desired.enabled && desired.emailEnabledForCustomer),
    sms: allDesired.some((desired) => desired.enabled && desired.smsEnabledForCustomer),
    whatsapp: allDesired.some((desired) => desired.enabled && desired.whatsappEnabledForCustomer),
  };
}

function isWhatsappInvalidAction(errors: AsaasError[]): boolean {
  return errors.some((error) => {
    const description = error.description?.toLowerCase() ?? '';
    return (
      error.code === 'invalid_action' &&
      (description.includes('whatsapp') || description.includes('evento inválido'))
    );
  });
}

function isMissingCustomerPhoneError(errors: AsaasError[]): boolean {
  return errors.some((error) => {
    const description = error.description?.toLowerCase() ?? '';
    return (
      error.code === 'invalid_action' &&
      description.includes('cliente') &&
      (description.includes('telefone') ||
        description.includes('celular') ||
        description.includes('phone') ||
        description.includes('mobile'))
    );
  });
}

async function readAsaasErrors(response: Response): Promise<AsaasError[]> {
  const errorData = await response.json().catch(() => ({ errors: [] }));
  return Array.isArray(errorData.errors) ? errorData.errors : [];
}

async function rememberWhatsappCapability(input: {
  contaId: string;
  notification: AsaasNotification;
  supported: boolean;
  code: string | null;
  environment: 'sandbox' | 'production';
}) {
  const event = input.notification.event as AsaasNotificationEvent;
  await prisma.asaasNotificationPreference.upsert({
    where: {
      contaId_event_scheduleOffset: {
        contaId: input.contaId,
        event,
        scheduleOffset: input.notification.scheduleOffset,
      },
    },
    create: {
      contaId: input.contaId,
      event,
      scheduleOffset: input.notification.scheduleOffset,
      whatsappCapabilitySupported: input.supported,
      whatsappCapabilityLastCheckedAt: new Date(),
      whatsappCapabilityLastErrorCode: input.code,
      whatsappCapabilityEnvironment: input.environment,
    },
    update: {
      whatsappCapabilitySupported: input.supported,
      whatsappCapabilityLastCheckedAt: new Date(),
      whatsappCapabilityLastErrorCode: input.code,
      whatsappCapabilityEnvironment: input.environment,
    },
  });
}

function withoutId(update: AsaasNotificationUpdate): Omit<AsaasNotificationUpdate, 'id'> {
  const { id: _id, ...body } = update;
  return body;
}

export async function getCustomerNotificationChannels(
  contaId: string,
  customerId: string,
): Promise<CustomerNotificationChannelsSnapshot> {
  const creds = await loadAsaasCredentials(contaId);
  if (!creds) {
    throw new Error('Conta sem credenciais financeiras configuradas');
  }

  const baseUrl = buildAsaasUrl(creds.apiKey);
  const response = await fetch(`${baseUrl}/customers/${customerId}/notifications`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token: creds.apiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao consultar notificações do cliente (${response.status}): ${body}`);
  }

  const raw = await response.json().catch(() => ({ data: [] }));
  const notifications = Array.isArray(raw?.data) ? (raw.data as AsaasNotification[]) : [];
  const activeNotifications = notifications.filter((item) => item.deleted !== true);

  return {
    email: activeNotifications.some(
      (item) => item.enabled === true && item.emailEnabledForCustomer === true,
    ),
    sms: activeNotifications.some(
      (item) => item.enabled === true && item.smsEnabledForCustomer === true,
    ),
    whatsapp: activeNotifications.some(
      (item) => item.enabled === true && item.whatsappEnabledForCustomer === true,
    ),
    notificationCount: activeNotifications.length,
  };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Política:
 * - Tenta aplicar email/sms/whatsapp conforme preferências
 * - Se WhatsApp falhar (invalid_action), faz retry sem WhatsApp para eventos afetados
 * - Registra warnings em vez de falhar
 * - Máximo 1 retry
 * 
 * @param contaId - ID da conta (para buscar credenciais)
 * @param customerId - ID do customer no Asaas (ex: cus_xxx)
 * @param preferences - Preferências de canais do usuário
 * @returns Resultado com canais aplicados e warnings
 */
export async function syncCustomerNotificationChannels(
  contaId: string,
  customerId: string,
  preferences: NotificationChannelPreferences,
  options: SyncNotificationOptions = {},
): Promise<SyncNotificationResult> {
  const warnings: NotificationWarning[] = [];
  const applied: NotificationChannelPreferences = { email: false, sms: false, whatsapp: false };

  try {
    // 1. Carregar credenciais
    const creds = await loadAsaasCredentials(contaId);
    if (!creds) {
      console.warn('[syncCustomerNotificationChannels] Credenciais Asaas não encontradas', { contaId });
      return { success: false, applied, warnings };
    }

    const baseUrl = buildAsaasUrl(creds.apiKey);
    const sandboxEnv = isSandboxBaseUrl(baseUrl);
    const headers = {
      'Content-Type': 'application/json',
      access_token: creds.apiKey,
    };

    // 2. Buscar notificações existentes
    const listRes = await fetch(`${baseUrl}/customers/${customerId}/notifications`, {
      method: 'GET',
      headers,
    });

    if (!listRes.ok) {
      const errorText = await listRes.text();
      console.warn('[syncCustomerNotificationChannels] Falha ao listar notificações', {
        customerId,
        status: listRes.status,
        error: errorText,
      });
      return { success: false, applied, warnings };
    }

    const listData = await listRes.json();
    const notifications: AsaasNotification[] = (listData.data || []).filter(
      (notification: AsaasNotification) => notification.deleted !== true,
    );

    if (notifications.length === 0) {
      // Cliente sem notificações (improvável, mas possível)
      return {
        success: true,
        applied: { ...preferences, whatsapp: preferences.whatsapp && !sandboxEnv },
        warnings,
      };
    }

    if (sandboxEnv && preferences.whatsapp) {
      await Promise.all(
        notifications.map((notification) =>
          rememberWhatsappCapability({
            contaId,
            notification,
            supported: false,
            code: 'sandbox_unsupported',
            environment: 'sandbox',
          }),
        ),
      );
    }

    const eventPreferences = toEventPreferenceMap(options.eventPreferences);

    // 3. Filtrar notificações que precisam de update
    const updatesNeeded: NotificationUpdateTask[] = [];
    const alreadyMatching: Array<{ desired: DesiredNotificationChannels }> = [];

    for (const notification of notifications) {
      const desired = resolveDesiredChannels(notification, preferences, eventPreferences, sandboxEnv);

      if (sandboxEnv && desired.whatsappEnabledForCustomer === false && preferences.whatsapp) {
        warnings.push({
          notificationId: notification.id,
          event: notification.event,
          channel: 'whatsapp',
          code: 'sandbox_unsupported',
          message: 'WhatsApp indisponível em sandbox',
        });
      }

      if (needsUpdate(notification, desired)) {
        updatesNeeded.push({
          notification,
          desired,
          update: buildUpdatePayload(notification, desired),
        });
      } else {
        alreadyMatching.push({ desired });
      }
    }

    if (updatesNeeded.length === 0) {
      return {
        success: true,
        applied: getAppliedFromTasks([], alreadyMatching),
        warnings,
      };
    }

    // 4. Tentar atualizar em lote (primeiro attempt)
    const batchPayload = {
      customer: customerId,
      notifications: updatesNeeded.map((task) => task.update),
    };

    const batchRes = await fetch(`${baseUrl}/notifications/batch`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(batchPayload),
    });

    if (batchRes.ok) {
      const environment = sandboxEnv ? 'sandbox' : 'production';
      await Promise.all(
        updatesNeeded
          .filter((task) => task.desired.whatsappEnabledForCustomer)
          .map((task) =>
            rememberWhatsappCapability({
              contaId,
              notification: task.notification,
              supported: true,
              code: null,
              environment,
            }),
          ),
      );

      return {
        success: true,
        applied: getAppliedFromTasks(updatesNeeded, alreadyMatching),
        warnings,
      };
    }

    // 5. Tratar erro do lote. Se envolver WhatsApp, aplicar fallback unitário
    // para não desativar todos os eventos por causa de uma única notificação.
    const errors = await readAsaasErrors(batchRes);
    const hasWhatsappInvalidAction = isWhatsappInvalidAction(errors);
    const hasMissingCustomerPhone = isMissingCustomerPhoneError(errors);
    const hasWhatsappAttempt = updatesNeeded.some(
      (task) => task.desired.whatsappEnabledForCustomer,
    );

    if ((!hasWhatsappInvalidAction && !hasMissingCustomerPhone) || !hasWhatsappAttempt) {
      console.warn('[syncCustomerNotificationChannels] Erro ao atualizar notificações', {
        customerId,
        status: batchRes.status,
        errors,
      });

      for (const err of errors) {
        warnings.push({
          notificationId: 'batch',
          event: 'multiple',
          channel: 'whatsapp',
          code: err.code,
          message: err.description,
        });
      }

      return {
        success: false,
        applied: getAppliedFromTasks([], alreadyMatching),
        warnings,
      };
    }

    console.warn('[syncCustomerNotificationChannels] Lote com WhatsApp falhou; aplicando fallback granular', {
      customerId,
      originalErrors: errors,
    });

    const appliedDesired: Array<{ desired: DesiredNotificationChannels }> = [...alreadyMatching];
    let failedUpdates = 0;
    const environment = sandboxEnv ? 'sandbox' : 'production';

    for (const task of updatesNeeded) {
      const response = await fetch(`${baseUrl}/notifications/${task.notification.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(withoutId(task.update)),
      });

      if (response.ok) {
        appliedDesired.push({ desired: task.desired });

        if (task.desired.whatsappEnabledForCustomer) {
          await rememberWhatsappCapability({
            contaId,
            notification: task.notification,
            supported: true,
            code: null,
            environment,
          });
        }

        continue;
      }

      const itemErrors = await readAsaasErrors(response);
      const itemWhatsappInvalid = isWhatsappInvalidAction(itemErrors);
      const itemMissingPhone = isMissingCustomerPhoneError(itemErrors);

      if (
        task.desired.whatsappEnabledForCustomer &&
        (itemWhatsappInvalid || itemMissingPhone)
      ) {
        const fallbackDesired = {
          ...task.desired,
          whatsappEnabledForCustomer: false,
        };
        const fallbackUpdate = buildUpdatePayload(task.notification, fallbackDesired);
        const retryResponse = await fetch(`${baseUrl}/notifications/${task.notification.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(withoutId(fallbackUpdate)),
        });

        if (retryResponse.ok) {
          appliedDesired.push({ desired: fallbackDesired });

          if (itemWhatsappInvalid && !itemMissingPhone) {
            await rememberWhatsappCapability({
              contaId,
              notification: task.notification,
              supported: false,
              code: 'invalid_action',
              environment,
            });
          }

          warnings.push({
            notificationId: task.notification.id,
            event: task.notification.event,
            channel: 'whatsapp',
            code: itemMissingPhone ? 'missing_customer_phone' : 'invalid_action',
            message: itemMissingPhone
              ? 'Cliente sem telefone apto para WhatsApp'
              : 'Evento não suporta notificação por WhatsApp',
          });

          continue;
        }
      }

      failedUpdates++;
      for (const err of itemErrors) {
        warnings.push({
          notificationId: task.notification.id,
          event: task.notification.event,
          channel: task.desired.whatsappEnabledForCustomer ? 'whatsapp' : 'email',
          code: err.code,
          message: err.description,
        });
      }
    }

    return {
      success: failedUpdates === 0,
      applied: getAppliedFromTasks([], appliedDesired),
      warnings,
    };
  } catch (error) {
    // Erro inesperado (rede, timeout, etc)
    console.error('[syncCustomerNotificationChannels] Erro inesperado', {
      contaId,
      customerId,
      error: error instanceof Error ? error.message : String(error),
    });

    return { success: false, applied, warnings };
  }
}
