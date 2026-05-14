'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import {
  NOTIFICATION_SECTIONS,
  type ChannelConfig,
} from '@/features/configuracoes/notificacoes/asaas/constants';
import type { NotificationPreference } from '@/features/configuracoes/notificacoes/asaas/types';
import { cn } from '@/lib/utils';

type CustomerNotificationPreference = NotificationPreference & { id?: string };

type CustomerNotificationsEditorProps = {
  customerId: string | null;
  endpoint: string;
  description?: string;
  emptyMessage?: string;
};

function readableError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const maybe = payload as { error?: unknown; message?: unknown };
    if (typeof maybe.error === 'string') return maybe.error;
    if (maybe.error && typeof maybe.error === 'object') {
      const nested = maybe.error as { message?: unknown };
      if (typeof nested.message === 'string') return nested.message;
    }
    if (typeof maybe.message === 'string') return maybe.message;
  }
  return fallback;
}

function normalizeNotificationPreference(
  preference: CustomerNotificationPreference,
): CustomerNotificationPreference {
  return {
    ...preference,
    scheduleOffset: preference.scheduleOffset ?? 0,
    enabled: preference.enabled ?? true,
    emailEnabledForProvider: Boolean(preference.emailEnabledForProvider),
    smsEnabledForProvider: Boolean(preference.smsEnabledForProvider),
    emailEnabledForCustomer: Boolean(preference.emailEnabledForCustomer),
    smsEnabledForCustomer: Boolean(preference.smsEnabledForCustomer),
    whatsappEnabledForCustomer: Boolean(preference.whatsappEnabledForCustomer),
    phoneCallEnabledForCustomer: Boolean(preference.phoneCallEnabledForCustomer),
  };
}

function serializeNotificationPreferences(preferences: CustomerNotificationPreference[]) {
  return JSON.stringify(
    [...preferences]
      .sort((a, b) =>
        a.event === b.event
          ? a.scheduleOffset - b.scheduleOffset
          : a.event.localeCompare(b.event),
      )
      .map((preference) => ({
        id: preference.id,
        event: preference.event,
        scheduleOffset: preference.scheduleOffset,
        enabled: preference.enabled,
        emailEnabledForProvider: preference.emailEnabledForProvider,
        smsEnabledForProvider: preference.smsEnabledForProvider,
        emailEnabledForCustomer: preference.emailEnabledForCustomer,
        smsEnabledForCustomer: preference.smsEnabledForCustomer,
        whatsappEnabledForCustomer: preference.whatsappEnabledForCustomer,
        phoneCallEnabledForCustomer: preference.phoneCallEnabledForCustomer,
      })),
  );
}

const sectionClass =
  'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-5 sm:py-4';

export function CustomerNotificationsEditor({
  customerId,
  endpoint,
  description = 'Configuração do customer no Asaas para cobranças atuais e próximas.',
  emptyMessage = 'Nenhum customer Asaas vinculado para configurar notificações.',
}: CustomerNotificationsEditorProps) {
  const [preferences, setPreferences] = useState<CustomerNotificationPreference[]>([]);
  const [originalPreferences, setOriginalPreferences] = useState<CustomerNotificationPreference[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(Boolean(customerId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCustomerNotifications = useCallback(async () => {
    if (!customerId) {
      setPreferences([]);
      setOriginalPreferences([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = `${endpoint}?customerId=${encodeURIComponent(customerId)}`;
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(readableError(payload, 'Erro ao carregar notificações do customer'));
      }
      const normalized = ((payload.preferences ?? []) as CustomerNotificationPreference[]).map(
        normalizeNotificationPreference,
      );
      setPreferences(normalized);
      setOriginalPreferences(normalized);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar notificações do customer');
      setPreferences([]);
      setOriginalPreferences([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, endpoint]);

  useEffect(() => {
    void loadCustomerNotifications();
  }, [loadCustomerNotifications]);

  const hasChanges = useMemo(
    () =>
      serializeNotificationPreferences(preferences) !==
      serializeNotificationPreferences(originalPreferences),
    [preferences, originalPreferences],
  );

  const updatePreference = useCallback(
    (
      event: CustomerNotificationPreference['event'],
      currentOffset: number,
      patch: Partial<CustomerNotificationPreference>,
    ) => {
      setPreferences((current) =>
        current.map((preference) =>
          preference.event === event && preference.scheduleOffset === currentOffset
            ? normalizeNotificationPreference({ ...preference, ...patch })
            : preference,
        ),
      );
    },
    [],
  );

  const handleCancel = () => {
    setPreferences(originalPreferences);
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!customerId || !hasChanges) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, preferences }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(readableError(payload, 'Erro ao salvar notificações'));
      }
      const normalized = ((payload.preferences ?? []) as CustomerNotificationPreference[]).map(
        normalizeNotificationPreference,
      );
      setPreferences(normalized);
      setOriginalPreferences(normalized);
      setEditing(false);
      pushToast({ title: 'Notificações do customer atualizadas', variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar notificações';
      setError(message);
      pushToast({
        title: 'Não foi possível salvar notificações',
        description: message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const controlsDisabled = loading || saving || !editing;

  return (
    <section className={sectionClass}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <span className="text-sm font-semibold text-slate-700">Configuração de notificações</span>
          <p className="text-xs text-slate-600">{description}</p>
          {customerId ? (
            <p className="text-xs text-slate-500">Customer Asaas: {customerId}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                disabled={saving}
                onClick={handleCancel}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="h-10 bg-brand-accent text-white hover:bg-brand-accent/90"
                disabled={saving || !hasChanges}
                onClick={() => void handleSave()}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-10"
              disabled={!customerId || loading || Boolean(error)}
              onClick={() => setEditing(true)}
            >
              Editar
            </Button>
          )}
        </div>
      </div>

      {!customerId ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:flex-row md:items-center md:justify-between">
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadCustomerNotifications()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-8">
          {NOTIFICATION_SECTIONS.map((section) => (
            <div key={section.id} className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {section.rows.map((row) => {
                  const preference = preferences.find(row.match);
                  if (!preference) return null;
                  return (
                    <div key={row.id} className="space-y-4 p-4 sm:p-5">
                      <div className="flex flex-col gap-4">
                        <NotificationChannelGroup
                          title="Para mim"
                          channels={row.providerChannels ?? []}
                          preference={preference}
                          disabled={controlsDisabled}
                          onToggle={(key, checked) =>
                            updatePreference(preference.event, preference.scheduleOffset, {
                              [key]: checked,
                            } as Partial<CustomerNotificationPreference>)
                          }
                        />
                        <NotificationChannelGroup
                          title="Meu cliente"
                          channels={row.customerChannels}
                          preference={preference}
                          disabled={controlsDisabled}
                          onToggle={(key, checked) =>
                            updatePreference(preference.event, preference.scheduleOffset, {
                              [key]: checked,
                            } as Partial<CustomerNotificationPreference>)
                          }
                        />
                      </div>

                      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-medium text-gray-900">{row.title}</p>
                          <p className="text-xs text-gray-500">{row.description}</p>
                        </div>
                        {row.scheduleEditable && row.scheduleOptions ? (
                          <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-gray-600">
                            <span>Enviar</span>
                            {editing ? (
                              <Select
                                value={String(preference.scheduleOffset)}
                                disabled={saving}
                                onValueChange={(value) =>
                                  updatePreference(preference.event, preference.scheduleOffset, {
                                    scheduleOffset: Number(value),
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-20 text-xs">
                                  <SelectValue placeholder="dias" />
                                </SelectTrigger>
                                <SelectContent>
                                  {row.scheduleOptions.map((option) => (
                                    <SelectItem key={option} value={String(option)}>
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="font-semibold text-gray-900">
                                {preference.scheduleOffset}
                              </span>
                            )}
                            <span>{row.scheduleLabel}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NotificationChannelGroup({
  title,
  channels,
  preference,
  disabled,
  onToggle,
}: {
  title: string;
  channels: ChannelConfig[];
  preference: CustomerNotificationPreference;
  disabled: boolean;
  onToggle: (_key: ChannelConfig['key'], _checked: boolean) => void;
}) {
  if (!channels.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}:</span>
      <div className="-mx-1 flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-0.5">
        {channels.map((channel) => {
          const checked = Boolean(preference[channel.key]);
          const channelDisabled = disabled || channel.disabled;
          return (
            <label
              key={channel.key}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                channelDisabled
                  ? checked
                    ? 'cursor-not-allowed border-purple-200 bg-purple-50 text-purple-500'
                    : 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
                  : checked
                    ? 'cursor-pointer border-purple-300 bg-purple-50 text-purple-700'
                    : 'cursor-pointer border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <Checkbox
                checked={checked}
                disabled={channelDisabled}
                onCheckedChange={(value) => onToggle(channel.key, Boolean(value))}
                className="h-3 w-3 shrink-0 sm:h-4 sm:w-4"
              />
              {channel.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
