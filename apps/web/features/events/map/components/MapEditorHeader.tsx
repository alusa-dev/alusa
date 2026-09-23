'use client';
import type { EventMapDTO } from '../api/event-map-service';
import { MapSettingsDialog } from './MapSettingsDialog';

import { cn } from '@/lib/utils';
import { CreatorIcon } from '@/components/icons/hugeicons';

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { BrandWordmark } from '@/components/brand/BrandWordmark';
import { toast } from '@/components/ui/toast';

export function MapEditorHeader({
  map,
  eventId,
  mapId,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
  onSettingsSaved,
  publishBlocked = false,
  onReferenceChartEditingChange,
}: {
  map: EventMapDTO;
  eventId: string;
  mapId: string;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  onSettingsSaved: (map: EventMapDTO) => void;
  publishBlocked?: boolean;
  onReferenceChartEditingChange: (editing: boolean) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  const previewUrl = `/events/${map.eventId}/maps/${map.id}/preview`;
  const publicUrl = map.publicUrl;
  const settingsDisabled = map.status === 'ARCHIVED';

  function handlePreview() {
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyPublicLink() {
    if (!publicUrl || map.status !== 'PUBLISHED') {
      toast.warning({ title: 'Link público indisponível', description: 'Publique o mapa antes de copiar o link público.' });
      return;
    }
    try {
      const absoluteUrl = new URL(publicUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absoluteUrl);
      setPublicLinkCopied(true);
      window.setTimeout(() => setPublicLinkCopied(false), 1800);
      toast.success({ title: 'Link público copiado' });
    } catch {
      toast.error({ title: 'Não foi possível copiar o link público' });
    }
  }

  return (
    <>
      <header className="absolute left-4 top-4 z-30 flex h-12 items-center rounded-lg border border-slate-200 bg-white/95 px-1.5 shadow-lg shadow-slate-300/30 backdrop-blur">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100">
          <Link href={`/events/${map.eventId}`} aria-label="Voltar para o evento">
            <CreatorIcon name="back" size={16} />
          </Link>
        </Button>
      </header>

      <div className="absolute left-[4.75rem] top-4 z-30 flex h-12 max-w-[calc(100%-6rem)] items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 shadow-lg shadow-slate-300/30 backdrop-blur">
        <BrandWordmark variant="purple" className="h-7 w-[92px]" width={92} height={28} />
        <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-950">{map.name?.trim() || 'Sem título'}</h1>
        </div>
        <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100"
          onClick={() => setSettingsOpen(true)}
          disabled={settingsDisabled}
          aria-label="Configurações do mapa"
        >
          <CreatorIcon name="settings" size={16} />
        </Button>
      </div>

      <MapSettingsDialog
        map={map}
        eventId={eventId}
        mapId={mapId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        disabled={settingsDisabled}
        onSaved={onSettingsSaved}
        onReferenceChartEditingChange={onReferenceChartEditingChange}
      />

      <div className="absolute right-4 top-4 z-30 flex h-12 max-w-[calc(100%-8rem)] items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-1.5 shadow-lg shadow-slate-300/30 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePreview}
          className="hidden text-slate-700 hover:bg-slate-100 md:inline-flex"
        >
          <CreatorIcon name="visible" size={14} />
          Pré-visualizar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopyPublicLink}
          disabled={!publicUrl || map.status !== 'PUBLISHED'}
          className="hidden text-slate-700 hover:bg-slate-100 disabled:opacity-45 lg:inline-flex"
        >
          <CreatorIcon name={publicLinkCopied ? 'copySuccess' : 'copy'} size={14} />
          {publicLinkCopied ? 'Link copiado' : 'Copiar link público'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="save-map-button"
          onClick={onSave}
          disabled={isSaving || map.status === 'ARCHIVED'}
          className="border-slate-200 bg-white text-slate-700 shadow-none"
        >
          {isSaving ? <CreatorIcon name="success" size={14} /> : <CreatorIcon name="save" size={14} />}
          {isSaving ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onPublish}
          disabled={isPublishing || map.status === 'ARCHIVED' || publishBlocked}
          className={cn('bg-brand-accent text-white hover:bg-brand-accent/90')}
        >
          <CreatorIcon name="publish" size={14} />
          {isPublishing ? 'Publicando...' : 'Publicar'}
        </Button>
      </div>
    </>
  );
}
