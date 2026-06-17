'use client';

import type { EventMapDTO } from '../api/event-map-service';
import { saveEventMapSettings } from '../api/event-map-service';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { MAP_PANEL_FIELD_CLASS } from './text-format-options';

export function MapSettingsDialog({
  map,
  open,
  onOpenChange,
  disabled,
  onSaved,
}: {
  map: EventMapDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onSaved: (map: EventMapDTO) => void;
}) {
  const [name, setName] = useState(map.name);
  const [publicEnabled, setPublicEnabled] = useState(Boolean(map.publicEnabled));

  useEffect(() => {
    if (!open) return;
    setName(map.name);
    setPublicEnabled(Boolean(map.publicEnabled));
  }, [map.name, map.publicEnabled, open]);

  const absolutePublicUrl = useMemo(() => {
    if (!map.publicUrl || map.status !== 'PUBLISHED') return null;
    return new URL(map.publicUrl, window.location.origin).toString();
  }, [map.publicUrl, map.status]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: { name?: string; publicEnabled?: boolean } = {};
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('Informe o nome do mapa.');
      if (trimmedName !== map.name.trim()) payload.name = trimmedName;
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
    await navigator.clipboard.writeText(absolutePublicUrl);
    toast.success({ title: 'Link público copiado' });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4">
          <DialogTitle className="text-base">Configurações do mapa</DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Ajustes rápidos de identidade e publicação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="map-settings-name">Nome do mapa</Label>
            <Input
              id="map-settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={disabled || saveMutation.isPending}
              className={MAP_PANEL_FIELD_CLASS}
              maxLength={120}
            />
          </div>

          {map.status === 'PUBLISHED' && absolutePublicUrl ? (
            <div className="space-y-2">
              <Label htmlFor="map-settings-public-url">Link público</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="map-settings-public-url"
                  readOnly
                  value={absolutePublicUrl}
                  className={MAP_PANEL_FIELD_CLASS}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 border-slate-200"
                  onClick={handleCopyPublicLink}
                  aria-label="Copiar link público"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-500">
              Publique o mapa para gerar o link público de venda.
            </p>
          )}

          {map.status === 'PUBLISHED' ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <div>
                <Label htmlFor="map-settings-public-enabled" className="text-sm font-medium text-slate-950">
                  Mapa público ativo
                </Label>
                <p className="mt-0.5 text-xs text-slate-500">Pausa ou retoma a venda sem republicar o layout.</p>
              </div>
              <Switch
                id="map-settings-public-enabled"
                checked={publicEnabled}
                onCheckedChange={setPublicEnabled}
                disabled={disabled || saveMutation.isPending}
              />
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-slate-500">
            Alterações de layout exigem republicar pelo botão <span className="font-medium text-slate-700">Publicar</span>.
          </p>
        </div>

        <DialogFooter className="border-t border-slate-200 px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={disabled || saveMutation.isPending}>
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
