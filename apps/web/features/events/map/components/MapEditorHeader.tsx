'use client';
import type { EventMapDTO } from '../api/event-map-service';

import { cn } from '@/lib/utils';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Copy, Eye, Save, Send, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

export function MapEditorHeader({
  map,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: {
  map: EventMapDTO;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: () => void;
}) {
  const previewUrl = `/events/${map.eventId}/maps/${map.id}/preview`;
  const publicUrl = map.publicUrl;

  function handlePreview() {
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleCopyPublicLink() {
    if (!publicUrl || map.status !== 'PUBLISHED') {
      toast.warning({ title: 'Link público indisponível', description: 'Publique o mapa antes de copiar o link público.' });
      return;
    }
    const absoluteUrl = new URL(publicUrl, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    toast.success({ title: 'Link público copiado' });
  }

  return (
    <>
      <header className="absolute left-4 top-4 z-30 flex h-12 items-center rounded-lg border border-slate-200 bg-white/95 px-1.5 shadow-lg shadow-slate-300/30 backdrop-blur">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-lg text-slate-600 hover:bg-slate-100">
          <Link href={`/events/${map.eventId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      </header>

      <div className="absolute left-[4.75rem] top-4 z-30 flex h-12 max-w-[calc(100%-6rem)] items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 shadow-lg shadow-slate-300/30 backdrop-blur">
        <img
          src="/brand/alusa-logo-dark.svg"
          alt="Alusa"
          width={92}
          height={28}
          className="h-7 w-[92px] shrink-0 object-contain"
          draggable={false}
        />
        <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-950">{map.name?.trim() || 'Sem título'}</h1>
        </div>
        <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden />
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100">
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute right-4 top-4 z-30 flex h-12 items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-1.5 shadow-lg shadow-slate-300/30 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePreview}
          className="hidden text-slate-700 hover:bg-slate-100 md:inline-flex"
        >
          <Eye className="h-3.5 w-3.5" />
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
          <Copy className="h-3.5 w-3.5" />
          Copiar link público
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
          {isSaving ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {isSaving ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onPublish}
          disabled={isPublishing || map.status === 'ARCHIVED'}
          className={cn('bg-brand-accent text-white hover:bg-brand-accent/90')}
        >
          <Send className="h-3.5 w-3.5" />
          {isPublishing ? 'Publicando...' : 'Publicar'}
        </Button>
      </div>
    </>
  );
}
