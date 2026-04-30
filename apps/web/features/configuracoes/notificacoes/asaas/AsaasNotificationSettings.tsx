'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomToast } from '@/components/ui/toast';
import { NOTIFICATION_SECTIONS, type ChannelConfig } from './constants';
import { useAsaasNotificationSettings } from './hooks/useAsaasNotificationSettings';
import type { NotificationPreference } from './types';
import { cn } from '@/lib/utils';

void React;

interface ChannelGroupProps {
  title: string;
  channels: ChannelConfig[];
  preference: NotificationPreference;
  disabled: boolean;
  onToggle: (_key: ChannelConfig['key'], _checked: boolean) => void;
}

function ChannelGroup({ title, channels, preference, disabled, onToggle }: ChannelGroupProps) {
  if (!channels.length) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-xs font-medium text-gray-500 uppercase tracking-wide">
        {title}:
      </span>
      <div className="flex items-center gap-2">
        {channels.map((channel) => {
          const isChecked = Boolean(preference[channel.key]);
          const isDisabled = disabled || channel.disabled;
          return (
            <label
              key={channel.key}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                isDisabled
                  ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : isChecked
                    ? 'border-purple-300 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <Checkbox
                disabled={isDisabled}
                checked={isChecked}
                onCheckedChange={(checked) => onToggle(channel.key, Boolean(checked))}
                className="h-3.5 w-3.5"
              />
              {channel.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-64" />
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="p-5 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="flex gap-4 mt-4">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AsaasNotificationSettings() {
  const {
    loading,
    saving,
    error,
    success,
    preferences,
    updatePreference,
    syncToExistingCustomers,
    fetchPreferences,
    setSuccess,
  } = useAsaasNotificationSettings();
  const [syncing, setSyncing] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  useEffect(() => {
    if (success) {
      console.log('[Asaas Notifications] Preferências salvas automaticamente');
      setSuccess(null);
    }
  }, [success, setSuccess]);

  const handleSyncExisting = async () => {
    setSyncing(true);
    try {
      await syncToExistingCustomers();
      setSyncDialogOpen(false);
      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Sincronização iniciada"
          description="Os registros existentes serão atualizados em segundo plano." 
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (err) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Falha na sincronização"
          description={err instanceof Error ? err.message : 'Erro inesperado.'}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSyncing(false);
    }
  };

  const sectionContent = useMemo(() => {
    if (!preferences.length) return null;
    return NOTIFICATION_SECTIONS.map((section) => (
      <section key={section.id} className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">{section.title}</h3>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {section.rows.map((row) => {
            const preference = preferences.find(row.match);
            if (!preference) {
              return (
                <div key={row.id} className="p-5 text-sm text-red-500">
                  Configuração não encontrada: {row.title}
                </div>
              );
            }
            const disabled = saving || syncing;
            return (
              <div key={row.id} className="p-5 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-0.5 flex-1">
                    <p className="text-sm font-medium text-gray-900">{row.title}</p>
                    <p className="text-xs text-gray-500">{row.description}</p>
                  </div>
                  {row.scheduleEditable && row.scheduleOptions ? (
                    <div className="flex items-center gap-2 text-xs text-gray-600 shrink-0 whitespace-nowrap">
                      <span>Enviar</span>
                      <Select
                        value={String(preference.scheduleOffset)}
                        disabled={disabled}
                        onValueChange={(value) =>
                          updatePreference(preference.event, preference.scheduleOffset, {
                            scheduleOffset: Number(value),
                          })
                        }
                      >
                        <SelectTrigger className="h-7 w-16 text-xs">
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
                      <span>{row.scheduleLabel}</span>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-8">
                  <ChannelGroup
                    title="Para mim"
                    channels={row.providerChannels ?? []}
                    preference={preference}
                    disabled={disabled}
                    onToggle={(key, checked) =>
                      updatePreference(preference.event, preference.scheduleOffset, {
                        [key]: checked,
                      } as Partial<NotificationPreference>)
                    }
                  />
                  <ChannelGroup
                    title="Meu cliente"
                    channels={row.customerChannels}
                    preference={preference}
                    disabled={disabled}
                    onToggle={(key, checked) =>
                      updatePreference(preference.event, preference.scheduleOffset, {
                        [key]: checked,
                      } as Partial<NotificationPreference>)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    ));
  }, [preferences, saving, syncing, updatePreference]);

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar preferências</AlertTitle>
          <AlertDescription className="mt-1 flex items-center gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={fetchPreferences}>
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {saving ? (
        <div className="flex items-center gap-2 text-xs text-purple-600">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Salvando...
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-6">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : (
        <div className="space-y-8">{sectionContent}</div>
      )}

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-600">
          Aplicar esta configuração também aos registros financeiros já existentes no sistema?
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={syncing || saving}
          onClick={() => setSyncDialogOpen(true)}
        >
          {syncing ? 'Sincronizando...' : 'Sincronizar existentes'}
        </Button>
      </div>

      <ConfirmDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        loading={syncing}
        title="Sobrescrever notificações dos customers existentes?"
        description="Esta ação reaplica a configuração global atual para todos os customers já existentes vinculados a esta conta. Ajustes individuais feitos depois no detalhe do aluno ou responsável serão substituídos."
        confirmText="Sobrescrever todos"
        cancelText="Cancelar"
        onConfirm={() => {
          void handleSyncExisting();
        }}
      />
    </div>
  );
}
