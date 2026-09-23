'use client';

import type { MapReferenceChart } from '@alusa/domain';
import { useEffect, useRef, useState } from 'react';

import { CreatorIcon } from '@/components/icons/hugeicons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import {
  updateEventMapReferenceChart,
  uploadEventMapReferenceChart,
} from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

export function MapReferenceChartPanel({
  eventId,
  mapId,
  disabled,
  embedded = false,
  onEditingChange,
}: {
  eventId: string;
  mapId: string;
  disabled: boolean;
  embedded?: boolean;
  onEditingChange: (_editing: boolean) => void;
}) {
  const chart = useEventMapEditorStore((state) => state.map?.referenceChart ?? null);
  const chartUrl = chart?.url ?? null;
  const chartOpacity = chart?.opacity ?? 0.5;
  const setReferenceChart = useEventMapEditorStore((state) => state.setReferenceChart);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [opacityDraft, setOpacityDraft] = useState(0.5);
  const opacitySaveInFlightRef = useRef(false);
  const savedOpacityRef = useRef({ url: chart?.url ?? null, value: chart?.opacity ?? 0.5 });

  useEffect(() => {
    setOpacityDraft(chartOpacity);
    if (!chartUrl) {
      savedOpacityRef.current = { url: null, value: 0.5 };
    } else if (chartUrl !== savedOpacityRef.current.url) {
      savedOpacityRef.current = { url: chartUrl, value: chartOpacity };
    }
  }, [chartUrl, chartOpacity]);

  async function persist(next: MapReferenceChart | null, successMessage?: string) {
    setBusy(true);
    try {
      const saved = await updateEventMapReferenceChart(eventId, mapId, next);
      setReferenceChart(saved.referenceChart ?? null);
      if (successMessage) toast.success({ title: successMessage });
      return saved.referenceChart ?? null;
    } catch (error) {
      toast.error({
        title: 'Não foi possível atualizar a planta',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const saved = await uploadEventMapReferenceChart(eventId, mapId, file);
      setReferenceChart(saved.referenceChart ?? null);
      onEditingChange(false);
      toast.success({ title: 'Planta de referência adicionada' });
    } catch (error) {
      toast.error({
        title: 'Não foi possível enviar a planta',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function toggleEditing() {
    if (!chart || busy) return;
    const editing = chart.locked;
    const next = { ...chart, locked: !editing };
    setReferenceChart(next);
    onEditingChange(editing);
    const saved = await persist(
      next,
      editing ? undefined : 'Posição da planta salva',
    );
    if (!saved) {
      setReferenceChart(chart);
      onEditingChange(!editing);
    }
  }

  function previewOpacity(value: number) {
    const nextOpacity = Math.min(1, Math.max(0.05, value));
    setOpacityDraft(nextOpacity);
    const current = useEventMapEditorStore.getState().map?.referenceChart;
    if (current) setReferenceChart({ ...current, opacity: nextOpacity });
  }

  async function commitOpacity() {
    if (busy || opacitySaveInFlightRef.current) return;
    const preview = useEventMapEditorStore.getState().map?.referenceChart;
    if (!preview || preview.opacity === savedOpacityRef.current.value) return;

    opacitySaveInFlightRef.current = true;
    const saved = await persist(preview);
    if (saved) {
      savedOpacityRef.current = { url: saved.url, value: saved.opacity };
    } else {
      const latest = useEventMapEditorStore.getState().map?.referenceChart;
      if (latest?.url === savedOpacityRef.current.url) {
        setReferenceChart({ ...latest, opacity: savedOpacityRef.current.value });
        setOpacityDraft(savedOpacityRef.current.value);
      }
    }
    opacitySaveInFlightRef.current = false;
  }

  async function removeChart() {
    if (!chart || busy) return;
    if (typeof window !== 'undefined' && !window.confirm('Remover a planta de referência deste mapa?')) return;
    const saved = await persist(null, 'Planta de referência removida');
    if (saved === null) onEditingChange(false);
  }

  return (
    <aside className={cn(
      'flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 backdrop-blur',
      embedded ? 'max-h-[24rem] shadow-none' : 'max-h-[22rem] shadow-lg shadow-slate-300/30',
    )}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreatorIcon name="reference" size={16} className="text-brand-accent" />
            <h2 className="text-sm font-semibold text-slate-950">Planta de referência</h2>
          </div>
          <p className="text-xs text-slate-500">Guia visual para construir o mapa</p>
        </div>
        {chart ? (
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">
            <CreatorIcon name="locked" size={12} />
            auxiliar
          </span>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled || busy}
        onChange={(event) => void handleUpload(event.target.files?.[0])}
      />

      <div className="min-h-0 overflow-y-auto p-3">
        {!chart ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center">
            <p className="text-xs leading-5 text-slate-500">
              Importe a planta do local para desenhar setores, blocos e fileiras por cima dela.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-3 h-8 w-full text-xs"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <CreatorIcon name="upload" size={14} />
              Adicionar planta
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500">
                <CreatorIcon name="reference" size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-800">{chart.fileName}</p>
                <p className="text-[10px] text-slate-500">
                  {chart.width} × {chart.height}px
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-2 text-xs text-slate-600">
                <Checkbox
                  checked={chart.visible}
                  disabled={disabled || busy}
                  onCheckedChange={(checked) =>
                    void persist({ ...chart, visible: checked === true })
                  }
                />
                <CreatorIcon name={chart.visible ? 'visible' : 'hidden'} size={14} />
                Mostrar no canvas
              </Label>
              <span className="text-[10px] text-slate-500">{Math.round(opacityDraft * 100)}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="100"
              value={Math.round(opacityDraft * 100)}
              disabled={disabled || busy}
              aria-label="Opacidade da planta de referência"
              className="h-1.5 w-full accent-brand-accent"
              onChange={(event) => previewOpacity(Number(event.target.value) / 100)}
              onPointerUp={() => void commitOpacity()}
              onKeyUp={() => void commitOpacity()}
              onBlur={() => void commitOpacity()}
            />

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={chart.locked ? 'outline' : 'default'}
                className="h-8 text-xs"
                disabled={disabled || busy}
                onClick={() => void toggleEditing()}
              >
                <CreatorIcon name={chart.locked ? 'edit' : 'locked'} size={14} />
                {chart.locked ? 'Editar planta' : 'Concluir edição'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={disabled || busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <CreatorIcon name="upload" size={14} />
                Substituir
              </Button>
            </div>

            <button
              type="button"
              disabled={disabled || busy}
              className="inline-flex w-full items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400 transition-colors hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void removeChart()}
            >
              <CreatorIcon name="delete" size={12} />
              Remover planta de referência
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
