'use client';

import type { EventMapDTO } from '../api/event-map-service';
import { saveEventMapSettings } from '../api/event-map-service';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { CreatorIcon } from '@/components/icons/hugeicons';
import { Button } from '@/components/ui/button';
import { LoadingDots } from '@/components/ui/LoadingDots';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { SectionCard, StepHeader } from '@/components/shared/wizard/layout';
import { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
import { MapReferenceChartPanel } from './MapReferenceChartPanel';

export function MapSettingsDialog({
  map,
  eventId,
  mapId,
  open,
  onOpenChange,
  disabled,
  onSaved,
  onReferenceChartEditingChange,
}: {
  map: EventMapDTO;
  eventId: string;
  mapId: string;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  disabled?: boolean;
  onSaved: (_map: EventMapDTO) => void;
  onReferenceChartEditingChange: (_editing: boolean) => void;
}) {
  const [name, setName] = useState(map.name);
  const [startsAt, setStartsAt] = useState(() => toDateTimeInputValue(map.startsAt ?? map.event.startsAt));
  const [endsAt, setEndsAt] = useState(() => toDateTimeInputValue(map.endsAt));
  const [locationName, setLocationName] = useState(map.locationName ?? '');
  const [locationAddress, setLocationAddress] = useState(map.locationAddress ?? '');
  const [publicEnabled, setPublicEnabled] = useState(Boolean(map.publicEnabled));
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(map.name);
    setStartsAt(toDateTimeInputValue(map.startsAt ?? map.event.startsAt));
    setEndsAt(toDateTimeInputValue(map.endsAt));
    setLocationName(map.locationName ?? '');
    setLocationAddress(map.locationAddress ?? '');
    setPublicEnabled(Boolean(map.publicEnabled));
  }, [map, open]);

  const absolutePublicUrl = useMemo(() => {
    if (!map.publicUrl || map.status !== 'PUBLISHED') return null;
    return new URL(map.publicUrl, window.location.origin).toString();
  }, [map.publicUrl, map.status]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: {
        name?: string;
        startsAt?: string | null;
        endsAt?: string | null;
        locationName?: string | null;
        locationAddress?: string | null;
        publicEnabled?: boolean;
      } = {};
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('Informe o nome do mapa.');
      if (trimmedName !== map.name.trim()) payload.name = trimmedName;
      const nextStartsAt = toDateTimeIso(startsAt);
      const nextEndsAt = toDateTimeIso(endsAt);
      if (nextStartsAt && nextEndsAt && new Date(nextEndsAt) <= new Date(nextStartsAt)) {
        throw new Error('O horário de término deve ser posterior ao início.');
      }
      const initialStartsAt = map.startsAt ?? map.event.startsAt;
      const initialEndsAt = map.endsAt;
      if (nextStartsAt !== initialStartsAt) payload.startsAt = nextStartsAt;
      if (nextEndsAt !== initialEndsAt) payload.endsAt = nextEndsAt;
      const nextLocationName = locationName.trim() || null;
      const nextLocationAddress = locationAddress.trim() || null;
      if (nextLocationName !== (map.locationName ?? null)) payload.locationName = nextLocationName;
      if (nextLocationAddress !== (map.locationAddress ?? null)) payload.locationAddress = nextLocationAddress;
      if (map.status === 'PUBLISHED' && publicEnabled !== Boolean(map.publicEnabled)) {
        payload.publicEnabled = publicEnabled;
      }
      if (Object.keys(payload).length === 0) {
        onOpenChange(false);
        return Promise.resolve(map);
      }
      return saveEventMapSettings(map.eventId, map.id, payload);
    },
    onSuccess: (savedMap) => {
      onSaved(savedMap);
      onOpenChange(false);
      toast.success({ title: 'Configurações salvas' });
    },
    onError: (error) => {
      toast.error({
        title: 'Não foi possível salvar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
    },
  });

  async function handleCopyPublicLink() {
    if (!absolutePublicUrl) return;
    try {
      await navigator.clipboard.writeText(absolutePublicUrl);
      setPublicLinkCopied(true);
      window.setTimeout(() => setPublicLinkCopied(false), 1800);
      toast.success({ title: 'Link público copiado' });
    } catch {
      toast.error({ title: 'Não foi possível copiar o link público' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen || !saveMutation.isPending) onOpenChange(nextOpen); }}>
      <DialogContent
        fullScreenMobile
        closeDisabled={saveMutation.isPending}
        className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[calc(100dvh-2rem)] max-w-2xl gap-0 overflow-hidden rounded-[20px] border border-slate-200 bg-white p-0 shadow-lg max-md:rounded-none"
      >
        <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-5 text-left max-md:px-4 max-md:pb-3 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
          <DialogTitle className="text-xl font-normal tracking-tight text-[#0f0f0f]">Configurações do mapa</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[#5c5c5c]">
            Defina os dados da sessão vinculada a este mapa.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto bg-white px-6 py-3 max-md:px-4">
          <SectionCard>
            <StepHeader title="Sessão" hint="Defina os dados desta apresentação." />
            <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="map-settings-name" className="text-xs">Nome do mapa</Label>
                <Input
                  id="map-settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={disabled || saveMutation.isPending}
                  className={wizardFieldInputClass}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="map-session-start" className="text-xs">Início</Label>
                <Input
                  id="map-session-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  disabled={disabled || saveMutation.isPending}
                  className={wizardFieldInputClass}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="map-session-end" className="text-xs">Término</Label>
                <Input
                  id="map-session-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  disabled={disabled || saveMutation.isPending}
                  className={wizardFieldInputClass}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="map-session-location" className="text-xs">Local</Label>
                <Input
                  id="map-session-location"
                  value={locationName}
                  onChange={(event) => setLocationName(event.target.value)}
                  disabled={disabled || saveMutation.isPending}
                  className={wizardFieldInputClass}
                  maxLength={255}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="map-session-address" className="text-xs">Endereço</Label>
                <Input
                  id="map-session-address"
                  value={locationAddress}
                  onChange={(event) => setLocationAddress(event.target.value)}
                  disabled={disabled || saveMutation.isPending}
                  className={wizardFieldInputClass}
                  maxLength={500}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Venda pública</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Gerencie o acesso à venda desta sessão.</p>
              </div>
              {map.status === 'PUBLISHED' ? (
                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  <Label htmlFor="map-settings-public-enabled" className="text-xs font-medium text-slate-700">
                    {publicEnabled ? 'Ativa' : 'Pausada'}
                  </Label>
                  <Switch
                    id="map-settings-public-enabled"
                    checked={publicEnabled}
                    onCheckedChange={setPublicEnabled}
                    disabled={disabled || saveMutation.isPending}
                    aria-label="Mapa público ativo"
                  />
                </div>
              ) : null}
            </div>
            {map.status === 'PUBLISHED' && absolutePublicUrl ? (
              <div className="relative">
                <Label htmlFor="map-settings-public-url" className="sr-only">Link público</Label>
                <Input
                  id="map-settings-public-url"
                  readOnly
                  value={absolutePublicUrl}
                  className={`${wizardFieldInputClass} pr-11`}
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#512a82]/40"
                  onClick={handleCopyPublicLink}
                  aria-label={publicLinkCopied ? 'Link público copiado' : 'Copiar link público'}
                  title={publicLinkCopied ? 'Link público copiado' : 'Copiar link público'}
                >
                  <CreatorIcon name={publicLinkCopied ? 'copySuccess' : 'copy'} size={16} />
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Publique o mapa para gerar o link de venda.</p>
            )}
            {map.status === 'PUBLISHED' ? (
              <p className="text-xs text-slate-500">Você pode pausar ou retomar as vendas sem republicar o layout.</p>
            ) : null}
          </SectionCard>

          <SectionCard>
            <StepHeader title="Planta de referência" hint="Auxiliar visual para montar o mapa." />
            <MapReferenceChartPanel
              eventId={eventId}
              mapId={mapId}
              disabled={disabled ?? false}
              embedded
              onEditingChange={onReferenceChartEditingChange}
            />
          </SectionCard>

          <p className="text-xs text-slate-500">
            Alterações no layout exigem republicação pelo botão <span className="font-medium text-slate-700">Publicar</span>.
          </p>
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-6 py-4 max-md:flex-col-reverse max-md:px-4 max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <Button
            type="button"
            variant="wizardSecondary"
            className="h-10 min-h-10 min-w-[120px] rounded-[10px] bg-[#eff3f8] px-5 font-normal text-[#303030] shadow-none hover:bg-[#eff3f8] max-md:w-full"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="wizardPrimary"
            className="h-10 min-h-10 min-w-[120px] rounded-[10px] bg-[#512a82] px-5 font-normal text-white shadow-none hover:bg-[#512a82] max-md:w-full disabled:opacity-60"
            onClick={() => saveMutation.mutate()}
            disabled={disabled || saveMutation.isPending}
          >
            {saveMutation.isPending ? <><span>Salvando</span><LoadingDots label="Salvando configurações do mapa" size="sm" className="text-white" /></> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDateTimeInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toDateTimeIso(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
