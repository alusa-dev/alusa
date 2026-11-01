'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotificationPreference } from '../types';
import {
  asaasNotificationPolicySchema,
  asaasNotificationPreferencesResultDTOSchema,
  saveAsaasNotificationPreferencesResultDTOSchema,
} from '../dtos';

type FetchResponse = typeof asaasNotificationPreferencesResultDTOSchema._type;
type SaveResponse = typeof saveAsaasNotificationPreferencesResultDTOSchema._type;
type NotificationPolicy = typeof asaasNotificationPolicySchema._type;
type NotificationSynchronization = FetchResponse['synchronization'];

function normalizePreference(pref: NotificationPreference): NotificationPreference {
  return {
    ...pref,
    scheduleOffset: pref.scheduleOffset ?? 0,
    enabled: pref.enabled ?? true,
    customerEnabled: pref.customerEnabled ?? true,
    emailEnabledForProvider: Boolean(pref.emailEnabledForProvider),
    smsEnabledForProvider: Boolean(pref.smsEnabledForProvider),
    emailEnabledForCustomer: Boolean(pref.emailEnabledForCustomer),
    smsEnabledForCustomer: Boolean(pref.smsEnabledForCustomer),
    whatsappEnabledForCustomer: Boolean(pref.whatsappEnabledForCustomer),
    phoneCallEnabledForCustomer: Boolean(pref.phoneCallEnabledForCustomer),
  };
}

function serializePreferences(prefs: NotificationPreference[]): string {
  return JSON.stringify(
    [...prefs]
      .sort((a, b) =>
        a.event === b.event
          ? a.scheduleOffset - b.scheduleOffset
          : a.event.localeCompare(b.event),
      )
      .map((pref) => ({
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
      })),
  );
}

export function useAsaasNotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalPrefs, setOriginalPrefs] = useState<NotificationPreference[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const initialPolicy: NotificationPolicy = { customerNotificationsEnabled: true, customerEmailNotificationsEnabled: true, customerWhatsAppNotificationsEnabled: true, customerSmsNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractNotificationsEnabled: true, contractEmailNotificationsEnabled: false, version: 1 };
  const [originalPolicy, setOriginalPolicy] = useState<NotificationPolicy>(initialPolicy);
  const [policy, setPolicy] = useState<NotificationPolicy>(initialPolicy);
  const [synchronization, setSynchronization] = useState<NotificationSynchronization>({ pending: 0, failed: 0, legacyPreferenceUnknown: 0 });
  const isMountedRef = useRef(true);

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/configuracoes/notificacoes/asaas', {
        cache: 'no-store',
      });
      const raw = (await response.json()) as FetchResponse & { error?: string };
      if (!response.ok) {
        throw new Error(raw.error || 'Erro ao carregar preferências');
      }
      const json = asaasNotificationPreferencesResultDTOSchema.parse(raw);
      const normalized = (json.preferences ?? []).map(normalizePreference);
      setOriginalPrefs(normalized);
      setPreferences(normalized);
      setOriginalPolicy(json.policy);
      setPolicy(json.policy);
      setSynchronization(json.synchronization);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar preferências');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchPreferences();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchPreferences]);

  const hasChanges = useMemo(() => {
    if (preferences.length !== originalPrefs.length) return true;
    return serializePreferences(preferences) !== serializePreferences(originalPrefs) ||
      policy.customerNotificationsEnabled !== originalPolicy.customerNotificationsEnabled ||
      policy.customerEmailNotificationsEnabled !== originalPolicy.customerEmailNotificationsEnabled ||
      policy.customerWhatsAppNotificationsEnabled !== originalPolicy.customerWhatsAppNotificationsEnabled ||
      policy.customerSmsNotificationsEnabled !== originalPolicy.customerSmsNotificationsEnabled ||
      policy.contractWhatsAppNotificationsEnabled !== originalPolicy.contractWhatsAppNotificationsEnabled ||
      policy.contractNotificationsEnabled !== originalPolicy.contractNotificationsEnabled ||
      policy.contractEmailNotificationsEnabled !== originalPolicy.contractEmailNotificationsEnabled;
  }, [preferences, originalPrefs, policy, originalPolicy]);

  const savePreferencesInternal = useCallback(
    async (prefsToSave: NotificationPreference[]) => {
      setSaving(true);
      setError(null);
      try {
        const response = await fetch('/api/configuracoes/notificacoes/asaas', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            preferences: prefsToSave,
            policy: {
              customerNotificationsEnabled: policy.customerNotificationsEnabled,
              customerEmailNotificationsEnabled: policy.customerEmailNotificationsEnabled,
              customerWhatsAppNotificationsEnabled: policy.customerWhatsAppNotificationsEnabled,
              customerSmsNotificationsEnabled: policy.customerSmsNotificationsEnabled,
              contractWhatsAppNotificationsEnabled: policy.contractWhatsAppNotificationsEnabled,
              contractNotificationsEnabled: policy.contractNotificationsEnabled,
              contractEmailNotificationsEnabled: policy.contractEmailNotificationsEnabled,
            },
          }),
        });
        const raw = (await response.json()) as SaveResponse & { error?: string };
        if (!response.ok) {
          throw new Error(raw.error || 'Erro ao salvar preferências');
        }
        const json = saveAsaasNotificationPreferencesResultDTOSchema.parse(raw);
        if (isMountedRef.current) {
          const normalized = (json.preferences ?? []).map(normalizePreference);
          setOriginalPrefs(normalized);
          setPreferences(normalized);
          setOriginalPolicy(json.policy);
          setPolicy(json.policy);
          setSynchronization(json.synchronization);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : 'Falha ao salvar');
        }
        throw err;
      } finally {
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    },
    [policy],
  );

  const updatePreference = useCallback(
    (event: NotificationPreference['event'], currentOffset: number, patch: Partial<NotificationPreference>) => {
      setPreferences((prev) => {
        const updated = prev.map((pref) =>
          pref.event === event && pref.scheduleOffset === currentOffset
            ? { ...pref, ...patch }
            : pref,
        );
        
        return updated;
      });
    },
    [],
  );

  const savePreferences = useCallback(async () => {
    await savePreferencesInternal(preferences);
  }, [preferences, savePreferencesInternal]);

  const reset = useCallback(() => {
    setPreferences(originalPrefs);
    setPolicy(originalPolicy);
    setError(null);
  }, [originalPrefs, originalPolicy]);

  const setCustomerNotificationsEnabled = useCallback((customerNotificationsEnabled: boolean) => {
    setPolicy((current) => ({ ...current, customerNotificationsEnabled }));
  }, []);

  const setCustomerChannelEnabled = useCallback((channel: 'email' | 'whatsapp' | 'sms', enabled: boolean) => {
    const key = channel === 'email' ? 'customerEmailNotificationsEnabled' : channel === 'whatsapp' ? 'customerWhatsAppNotificationsEnabled' : 'customerSmsNotificationsEnabled';
    setPolicy((current) => ({ ...current, [key]: enabled }));
  }, []);

  const setContractWhatsAppNotificationsEnabled = useCallback((contractWhatsAppNotificationsEnabled: boolean) => {
    setPolicy((current) => ({ ...current, contractWhatsAppNotificationsEnabled }));
  }, []);

  const setContractNotificationsEnabled = useCallback((contractNotificationsEnabled: boolean) => {
    setPolicy((current) => ({ ...current, contractNotificationsEnabled }));
  }, []);

  const setContractChannelEnabled = useCallback((channel: 'email' | 'whatsapp', enabled: boolean) => {
    const key = channel === 'email' ? 'contractEmailNotificationsEnabled' : 'contractWhatsAppNotificationsEnabled';
    setPolicy((current) => ({ ...current, [key]: enabled }));
  }, []);

  return {
    loading,
    saving,
    error,
    preferences,
    policy,
    synchronization,
    hasChanges,
    fetchPreferences,
    updatePreference,
    reset,
    savePreferences,
    setCustomerNotificationsEnabled,
    setCustomerChannelEnabled,
    setContractWhatsAppNotificationsEnabled,
    setContractNotificationsEnabled,
    setContractChannelEnabled,
  };
}
