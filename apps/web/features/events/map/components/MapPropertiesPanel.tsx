'use client';
import {
  TEXT_MODE_LABELS,
  applyArtboardOrientation,
  applyTextModePatch,
  clampArtboardHeight,
  clampArtboardWidth,
  getArtboardOrientation,
  getPrimarySelection,
  getSelectableItems,
  getTextMode,
  normalizeRotation,
  resolveSeatedSectorFromSelection,
  shortestRotationDelta,
  validateDuplicateSelection,
} from '@alusa/domain';
import type { TextMode } from '@alusa/domain';
import type { TicketLotDTO } from '../../events-service';
import type { EventMapDTO, EventMapLevelDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

import { cn } from '@/lib/utils';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RectangleHorizontal, RectangleVertical, CircleAlert } from 'lucide-react';

import { EVENT_SEAT_STATUS_LABELS, EVENT_SEAT_STATUSES } from '@alusa/shared';

import { SeatedSectorProperties } from './SeatedSectorProperties';
import {
  MAP_PANEL_COLOR_INPUT_CLASS,
  MAP_PANEL_FIELD_CLASS,
  MAP_PANEL_GRID_CLASS,
  MAP_PANEL_SECTION_CLASS,
  MAP_PANEL_SECTION_TITLE_CLASS,
  MAP_PANEL_SELECT_TRIGGER_CLASS,
  MAP_TEXT_AREA_CLASS,
} from './text-format-options';
import {
  MAP_PANEL_SELECT_NONE_VALUE,
  MapPanelSelect,
  mapNullableSelectChange,
  mapNullableSelectValue,
} from './MapPanelSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const FIELD_CLASS = MAP_PANEL_FIELD_CLASS;
const SELECT_TRIGGER_CLASS = MAP_PANEL_SELECT_TRIGGER_CLASS;
const COLOR_INPUT_CLASS = MAP_PANEL_COLOR_INPUT_CLASS;
const PANEL_GRID_CLASS = MAP_PANEL_GRID_CLASS;

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function PanelField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs font-medium text-slate-500">{label}</Label>
        {hint ? (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
                  aria-label={hint}
                >
                  <CircleAlert className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-56 text-xs">
                {hint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function PanelToggleField({
  label,
  enabled,
  disabled,
  onEnabledChange,
  children,
}: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
          aria-label={`Ativar ${label}`}
        />
        <Label className="text-xs font-medium text-slate-500">{label}</Label>
      </div>
      <div className={cn(!enabled && 'pointer-events-none opacity-50')}>{children}</div>
    </div>
  );
}

function isAppearanceFlagEnabled(value: unknown, fallback = true) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={MAP_PANEL_SECTION_CLASS}>
      <h3 className={MAP_PANEL_SECTION_TITLE_CLASS}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ArtboardSizeInput({
  label,
  value,
  disabled,
  clamp,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  clamp: (next: number) => number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(String(value));
  }, [isEditing, value]);

  function commitDraft() {
    const trimmed = draft.trim();
    const parsed = trimmed === '' ? value : toNumber(trimmed, value);
    const next = clamp(parsed);
    setDraft(String(next));
    setIsEditing(false);
    if (next !== value) onCommit(next);
  }

  return (
    <PanelField label={label}>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        disabled={disabled}
        aria-label={label}
        className={cn(FIELD_CLASS, '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none')}
        onFocus={() => setIsEditing(true)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setDraft(String(value));
            setIsEditing(false);
            event.currentTarget.blur();
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '' || /^\d+$/.test(next)) setDraft(next);
        }}
      />
    </PanelField>
  );
}

function LevelArtboardProperties({
  level,
  disabled,
  onUpdate,
}: {
  level: EventMapLevelDTO;
  disabled: boolean;
  onUpdate: (patch: Partial<Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>>) => void;
}) {
  const orientation = getArtboardOrientation(level);

  return (
    <PanelSection title="Prancheta">
      <PanelField label="Orientação">
        <div
          className="grid w-full grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1"
          role="tablist"
          aria-label="Orientação da prancheta"
        >
          <button
            type="button"
            role="tab"
            aria-selected={orientation === 'landscape'}
            disabled={disabled}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
              orientation === 'landscape'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950',
              disabled && 'pointer-events-none opacity-50',
            )}
            onClick={() => onUpdate(applyArtboardOrientation(level, 'landscape'))}
          >
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
              <RectangleHorizontal className="h-3.5 w-3.5" />
            </span>
            Horizontal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={orientation === 'portrait'}
            disabled={disabled}
            className={cn(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
              orientation === 'portrait'
                ? 'bg-white text-slate-950 shadow-sm'
                : 'text-slate-600 hover:text-slate-950',
              disabled && 'pointer-events-none opacity-50',
            )}
            onClick={() => onUpdate(applyArtboardOrientation(level, 'portrait'))}
          >
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
              <RectangleVertical className="h-3.5 w-3.5" />
            </span>
            Vertical
          </button>
        </div>
      </PanelField>
      <div className={PANEL_GRID_CLASS}>
        <ArtboardSizeInput
          label="Largura"
          value={level.widthPx}
          disabled={disabled}
          clamp={clampArtboardWidth}
          onCommit={(widthPx) => onUpdate({ widthPx })}
        />
        <ArtboardSizeInput
          label="Altura"
          value={level.heightPx}
          disabled={disabled}
          clamp={clampArtboardHeight}
          onCommit={(heightPx) => onUpdate({ heightPx })}
        />
      </div>
      <p className="text-xs text-slate-500">Pressione Enter ou saia do campo para aplicar o tamanho.</p>
    </PanelSection>
  );
}

function TextProperties({
  object,
  disabled,
  inlineEditorActive,
  onUpdate,
}: {
  object: EventMapObjectDTO;
  disabled: boolean;
  inlineEditorActive: boolean;
  onUpdate: (patch: Partial<EventMapObjectDTO>) => void;
}) {
  const data = object.data;
  const textMode = getTextMode(object);
  const fill = String(data.fill ?? '#0f172a');
  const stroke = String(data.stroke ?? '#000000');
  const strokeWidth = numberValue(typeof data.strokeWidth === 'number' ? data.strokeWidth : Number(data.strokeWidth), 0);
  const opacity = numberValue(typeof data.opacity === 'number' ? data.opacity : Number(data.opacity), 1);
  const verticalAlign = String(data.verticalAlign ?? 'top');
  const lineHeight = numberValue(typeof data.lineHeight === 'number' ? data.lineHeight : Number(data.lineHeight), 1.2);
  const letterSpacing = numberValue(typeof data.letterSpacing === 'number' ? data.letterSpacing : Number(data.letterSpacing), 0);
  const contentDisabled = disabled || inlineEditorActive;

  function updateData(patch: Record<string, unknown>) {
    onUpdate({ data: { ...object.data, ...patch } });
  }

  function setTextMode(mode: TextMode) {
    onUpdate(applyTextModePatch(mode, object));
  }

  return (
    <>
      <PanelSection title="Texto">
        <PanelField label="Modo">
          <Select value={textMode} disabled={disabled} onValueChange={(value) => setTextMode(value as TextMode)}>
            <SelectTrigger className={SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-[13px]">
              {(Object.entries(TEXT_MODE_LABELS) as [TextMode, string][]).map(([mode, label]) => (
                <SelectItem key={mode} value={mode}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PanelField>
        <PanelField label="Conteúdo">
          <Textarea
            value={String(data.text ?? '')}
            disabled={contentDisabled}
            onChange={(event) => updateData({ text: event.target.value, label: event.target.value })}
            className={MAP_TEXT_AREA_CLASS}
          />
          {inlineEditorActive ? (
            <p className="text-xs text-slate-500">Edição em andamento no canvas.</p>
          ) : null}
        </PanelField>
      </PanelSection>

      <PanelSection title="Dimensão">
        <div className={PANEL_GRID_CLASS}>
          <PanelField label="X"><Input type="number" value={object.x} disabled={disabled} onChange={(event) => onUpdate({ x: toNumber(event.target.value, object.x) })} className={FIELD_CLASS} /></PanelField>
          <PanelField label="Y"><Input type="number" value={object.y} disabled={disabled} onChange={(event) => onUpdate({ y: toNumber(event.target.value, object.y) })} className={FIELD_CLASS} /></PanelField>
          {textMode !== 'auto' ? (
            <PanelField label="Largura">
              <Input
                type="number"
                min={1}
                value={object.width ?? ''}
                disabled={disabled}
                onChange={(event) => onUpdate({ width: Math.max(1, toNumber(event.target.value, object.width ?? 160)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
          ) : null}
          {textMode === 'area' ? (
            <PanelField label="Altura">
              <Input
                type="number"
                min={1}
                value={object.height ?? ''}
                disabled={disabled}
                onChange={(event) => onUpdate({ height: Math.max(1, toNumber(event.target.value, object.height ?? 60)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
          ) : null}
          <PanelField label="Rotação"><Input type="number" value={object.rotation ?? 0} disabled={disabled} onChange={(event) => onUpdate({ rotation: toNumber(event.target.value, object.rotation ?? 0) })} className={FIELD_CLASS} /></PanelField>
        </div>
      </PanelSection>

      <PanelSection title="Tipografia">
        <p className="text-xs text-slate-500">
          Use a barra flutuante abaixo do mapa para fonte, tamanho, estilo e alinhamento.
        </p>

        <div className={PANEL_GRID_CLASS}>
          <PanelField label="Linha"><Input type="number" min={0.5} step={0.1} value={lineHeight} disabled={disabled} onChange={(event) => updateData({ lineHeight: Math.max(0.5, toNumber(event.target.value, lineHeight)) })} className={FIELD_CLASS} /></PanelField>
          <PanelField label="Espaçamento"><Input type="number" value={letterSpacing} disabled={disabled} onChange={(event) => updateData({ letterSpacing: toNumber(event.target.value, letterSpacing) })} className={FIELD_CLASS} /></PanelField>
        </div>

        <PanelField label="Alinhamento vertical">
          <Select
            value={verticalAlign}
            disabled={disabled || textMode === 'auto'}
            onValueChange={(value) => updateData({ verticalAlign: value })}
          >
            <SelectTrigger className={SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-[13px]">
              <SelectItem value="top">Topo</SelectItem>
              <SelectItem value="middle">Meio</SelectItem>
              <SelectItem value="bottom">Base</SelectItem>
            </SelectContent>
          </Select>
        </PanelField>
      </PanelSection>

      <PanelSection title="Aparência">
        <PanelField label={`Opacidade ${Math.round(opacity * 100)}%`}>
          <input type="range" min={0} max={100} value={Math.round(opacity * 100)} disabled={disabled} onChange={(event) => updateData({ opacity: Number(event.target.value) / 100 })} className="h-9 w-full accent-[color:var(--brand-accent,#6d28d9)]" />
        </PanelField>
        <PanelField label="Cor do texto">
          <div className="flex gap-2"><input type="color" value={fill} disabled={disabled} onChange={(event) => updateData({ fill: event.target.value })} className={COLOR_INPUT_CLASS} /><Input value={fill} disabled={disabled} onChange={(event) => updateData({ fill: event.target.value })} className={FIELD_CLASS} /></div>
        </PanelField>
        <PanelField label="Traçado do texto">
          <div className="flex gap-2"><input type="color" value={stroke} disabled={disabled} onChange={(event) => updateData({ stroke: event.target.value })} className={COLOR_INPUT_CLASS} /><Input value={stroke} disabled={disabled} onChange={(event) => updateData({ stroke: event.target.value })} className={FIELD_CLASS} /></div>
        </PanelField>
        <PanelField label="Espessura do traçado">
          <Input type="number" min={0} value={strokeWidth} disabled={disabled} onChange={(event) => updateData({ strokeWidth: Math.max(0, toNumber(event.target.value, strokeWidth)) })} className={FIELD_CLASS} />
        </PanelField>
      </PanelSection>
    </>
  );
}

function ObjectProperties({
  object,
  disabled,
  onUpdate,
}: {
  object: EventMapObjectDTO;
  disabled: boolean;
  onUpdate: (patch: Partial<EventMapObjectDTO>) => void;
}) {
  const label = String(object.data.text ?? object.data.label ?? '');
  const fill = String(object.data.fill ?? '#ffffff');
  const stroke = String(object.data.stroke ?? '#64748b');
  const strokeWidth = numberValue(typeof object.data.strokeWidth === 'number' ? object.data.strokeWidth : Number(object.data.strokeWidth), 1.5);
  const strokeStyle = String(object.data.strokeStyle ?? (object.type === 'CORRIDOR' ? 'dashed' : 'solid'));
  const opacity = numberValue(typeof object.data.opacity === 'number' ? object.data.opacity : Number(object.data.opacity), object.type === 'SECTION' ? 0 : 1);
  const cornerRadius = numberValue(typeof object.data.cornerRadius === 'number' ? object.data.cornerRadius : Number(object.data.cornerRadius), object.type === 'TABLE' ? 999 : object.data.shape ? 0 : 8);
  const fillEnabled = isAppearanceFlagEnabled(object.data.fillEnabled);
  const strokeEnabled = isAppearanceFlagEnabled(object.data.strokeEnabled);
  const strokeWidthEnabled = isAppearanceFlagEnabled(object.data.strokeWidthEnabled);
  const strokeControlsEnabled = strokeEnabled && strokeWidthEnabled;

  function updateData(patch: Record<string, unknown>) {
    onUpdate({ data: { ...object.data, ...patch } });
  }

  return (
    <>
      <PanelSection title="Conteúdo">
        <PanelField label="Texto/Nome">
          <Input
            value={label}
            disabled={disabled}
            onChange={(event) => updateData({ text: event.target.value, label: event.target.value })}
            className={FIELD_CLASS}
          />
        </PanelField>
      </PanelSection>

      <PanelSection title="Dimensão">
        <div className={PANEL_GRID_CLASS}>
          <PanelField label="X">
            <Input type="number" value={numberValue(object.x)} disabled={disabled} onChange={(event) => onUpdate({ x: toNumber(event.target.value, numberValue(object.x)) })} className={FIELD_CLASS} />
          </PanelField>
          <PanelField label="Y">
            <Input type="number" value={numberValue(object.y)} disabled={disabled} onChange={(event) => onUpdate({ y: toNumber(event.target.value, numberValue(object.y)) })} className={FIELD_CLASS} />
          </PanelField>
          <PanelField label="Largura">
            <Input type="number" min={1} value={object.width != null && Number.isFinite(object.width) ? object.width : ''} disabled={disabled} onChange={(event) => onUpdate({ width: Math.max(1, toNumber(event.target.value, object.width ?? 1)) })} className={FIELD_CLASS} />
          </PanelField>
          <PanelField label="Altura">
            <Input type="number" min={1} value={object.height != null && Number.isFinite(object.height) ? object.height : ''} disabled={disabled} onChange={(event) => onUpdate({ height: Math.max(1, toNumber(event.target.value, object.height ?? 1)) })} className={FIELD_CLASS} />
          </PanelField>
          <PanelField label="Rotação">
            <Input
              data-testid={object.type === 'CORRIDOR' ? 'corridor-rotation' : undefined}
              type="number"
              step={1}
              value={numberValue(object.rotation, 0)}
              disabled={disabled}
              onChange={(event) =>
                onUpdate({
	                  rotation:
	                    object.type === 'CORRIDOR'
	                      ? normalizeRotation(toNumber(event.target.value, object.rotation ?? 0))
	                      : toNumber(event.target.value, object.rotation ?? 0),
                })
              }
              className={FIELD_CLASS}
            />
          </PanelField>
        </div>
      </PanelSection>

      {object.type === 'CORRIDOR' ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Corredor visual: não desloca assentos. Interseções entre dois ou mais corredores continuam destacadas no mapa.
        </p>
      ) : null}

      <PanelSection title="Aparência">
        {object.type !== 'SECTION' ? (
          <PanelField label={`Opacidade ${Math.round(opacity * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              disabled={disabled}
              onChange={(event) => updateData({ opacity: Number(event.target.value) / 100 })}
              className="h-9 w-full accent-[color:var(--brand-accent,#6d28d9)]"
            />
          </PanelField>
        ) : null}

        {object.type !== 'SECTION' ? (
          <PanelToggleField
            label="Preenchimento"
            enabled={fillEnabled}
            disabled={disabled}
            onEnabledChange={(enabled) => updateData({ fillEnabled: enabled })}
          >
            <div className="flex gap-2">
              <input type="color" value={fill} disabled={disabled || !fillEnabled} onChange={(event) => updateData({ fill: event.target.value })} className={COLOR_INPUT_CLASS} />
              <Input value={fill} disabled={disabled || !fillEnabled} onChange={(event) => updateData({ fill: event.target.value })} className={FIELD_CLASS} />
            </div>
          </PanelToggleField>
        ) : null}

        <PanelToggleField
          label="Traçado"
          enabled={strokeEnabled}
          disabled={disabled}
          onEnabledChange={(enabled) => updateData({ strokeEnabled: enabled })}
        >
          <div className="flex gap-2">
            <input type="color" value={stroke} disabled={disabled || !strokeEnabled} onChange={(event) => updateData({ stroke: event.target.value })} className={COLOR_INPUT_CLASS} />
            <Input value={stroke} disabled={disabled || !strokeEnabled} onChange={(event) => updateData({ stroke: event.target.value })} className={FIELD_CLASS} />
          </div>
        </PanelToggleField>

        <div className={PANEL_GRID_CLASS}>
          <PanelToggleField
            label="Espessura"
            enabled={strokeWidthEnabled}
            disabled={disabled}
            onEnabledChange={(enabled) => updateData({ strokeWidthEnabled: enabled })}
          >
            <Input type="number" min={0} value={strokeWidth} disabled={disabled || !strokeWidthEnabled} onChange={(event) => updateData({ strokeWidth: Math.max(0, toNumber(event.target.value, strokeWidth)) })} className={FIELD_CLASS} />
          </PanelToggleField>
          <PanelField label="Estilo">
            <MapPanelSelect
              value={strokeStyle}
              disabled={disabled || !strokeControlsEnabled}
              className={!strokeControlsEnabled ? 'opacity-50' : undefined}
              options={[
                { value: 'solid', label: 'Sólido' },
                { value: 'dashed', label: 'Tracejado' },
                { value: 'dotted', label: 'Pontilhado' },
              ]}
              onValueChange={(value) => updateData({ strokeStyle: value })}
            />
          </PanelField>
        </div>

        <PanelField label="Arredondamento">
          <Input
            type="number"
            min={0}
            value={cornerRadius}
            disabled={disabled}
            onChange={(event) => updateData({ cornerRadius: Math.max(0, toNumber(event.target.value, cornerRadius)) })}
            className={FIELD_CLASS}
          />
        </PanelField>
      </PanelSection>
    </>
  );
}

export function MapPropertiesPanel({ lots, status }: { lots: TicketLotDTO[]; status: EventMapDTO['status'] }) {
  const map = useEventMapEditorStore((state) => state.map);
  const selection = useEventMapEditorStore((state) => state.selection);
  const updateSection = useEventMapEditorStore((state) => state.updateSection);
  const updateSeat = useEventMapEditorStore((state) => state.updateSeat);
  const updateObject = useEventMapEditorStore((state) => state.updateObject);
  const updateLevel = useEventMapEditorStore((state) => state.updateLevel);
  const fitArtboardToView = useEventMapEditorStore((state) => state.fitArtboardToView);
  const updateSeatGroup = useEventMapEditorStore((state) => state.updateSeatGroup);
  const applyTransform = useEventMapEditorStore((state) => state.applyTransform);
  const deleteSeatGroup = useEventMapEditorStore((state) => state.deleteSeatGroup);
  const deleteSection = useEventMapEditorStore((state) => state.deleteSection);
  const inlineTextEditorActive = useEventMapEditorStore((state) => state.inlineTextEditorActive);
  const disabled = status === 'ARCHIVED';
  const multiSelectCount = getSelectableItems(selection).length;

  const seatedSector = useMemo(() => {
    if (!map || multiSelectCount > 1) return null;
    return resolveSeatedSectorFromSelection(map, selection);
  }, [map, multiSelectCount, selection]);

  const duplicateValidation = useMemo(() => {
    if (!map) return { ok: true as const };
    return validateDuplicateSelection(map, selection);
  }, [map, selection]);

  const selected = useMemo(() => {
    if (!map || selection.length === 0) return null;
    const primary = getPrimarySelection(selection);
    if (!primary) return null;
    if (primary.type === 'section') return { type: 'section' as const, value: map.sections.find((section) => section.id === primary.id) };
    if (primary.type === 'seat') return { type: 'seat' as const, value: map.seats.find((seat) => seat.id === primary.id) };
    if (primary.type === 'seatgroup') return { type: 'seatgroup' as const, value: (map.seatGroups ?? []).find((g) => g.id === primary.id) };
    if (primary.type === 'object') return { type: 'object' as const, value: map.objects.find((object) => object.id === primary.id) };
    if (primary.type === 'level') return { type: 'level' as const, value: map.levels.find((level) => level.id === primary.id) };
    return null;
  }, [map, selection]);

  function updateLevelArtboard(
    levelId: string,
    patch: Partial<Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>>,
  ) {
    updateLevel(levelId, patch);
    fitArtboardToView();
  }

  function updateSectionObjectData(objectId: string, patch: { label?: string }) {
    const object = map?.objects.find((entry) => entry.id === objectId);
    if (!object) return;
    updateObject(objectId, { data: { ...object.data, ...patch } });
  }

  function rotateSeatGroupLikeCanvas(groupId: string, nextRotation: number, currentRotation: number) {
    const angleDelta = shortestRotationDelta(currentRotation, nextRotation);
    if (Math.abs(angleDelta) < 0.001) return;
    applyTransform({
      type: 'ROTATE_SELECTION',
      payload: {
        selection: [{ type: 'seatgroup', id: groupId }],
        angleDelta,
        mode: 'free',
      },
    });
  }

  return (
    <aside
      data-testid="properties-panel"
      className="absolute right-4 top-24 z-20 flex max-h-[calc(100%-8rem)] w-80 flex-col rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-950">Propriedades</h2>
        <p className="text-xs text-slate-500">Configurações do item selecionado</p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {multiSelectCount > 1 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">{multiSelectCount} itens selecionados</p>
            <p className="mt-1 text-xs text-slate-500">
              {duplicateValidation.ok
                ? 'Mova, duplique ou exclua em lote. Use ⌘/Ctrl + G para agrupar e ⌘/Ctrl + U para desagrupar.'
                : 'Mova ou exclua em lote. Duplique apenas um grupo de assentos por vez. Use ⌘/Ctrl + G para agrupar e ⌘/Ctrl + U para desagrupar.'}
            </p>
          </div>
        ) : null}

        {!selected?.value && !seatedSector ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Selecione uma prancheta, setor, cadeira ou objeto para editar propriedades.
          </div>
        ) : null}

        {multiSelectCount <= 1 && seatedSector ? (
          <SeatedSectorProperties
            context={seatedSector}
            lots={lots}
            disabled={disabled}
            onUpdateSection={updateSection}
            onUpdateSeatGroup={updateSeatGroup}
            onUpdateSectionObject={updateSectionObjectData}
            onRotateSeatGroup={rotateSeatGroupLikeCanvas}
            onDeleteSection={deleteSection}
          />
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'section' && selected.value! && !seatedSector ? (
          <PanelSection title="Setor">
            <PanelField label="Nome do setor">
              <Input
                value={selected.value!.name}
                disabled={disabled}
                onChange={(event) => updateSection(selected.value!.id, { name: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Lote vinculado">
              <MapPanelSelect
                value={mapNullableSelectValue(selected.value!.lotId)}
                disabled={disabled}
                placeholder="Sem lote"
                options={[
                  { value: MAP_PANEL_SELECT_NONE_VALUE, label: 'Sem lote' },
                  ...lots.map((lot) => ({ value: lot.id, label: lot.name })),
                ]}
                onValueChange={(value) =>
                  updateSection(selected.value!.id, { lotId: mapNullableSelectChange(value) })
                }
              />
            </PanelField>
            <PanelField label="Capacidade">
              <Input
                type="number"
                min={0}
                value={selected.value!.capacity ?? ''}
                disabled={disabled}
                onChange={(event) => updateSection(selected.value!.id, { capacity: event.target.value ? Number(event.target.value) : null })}
                className={FIELD_CLASS}
              />
            </PanelField>
          </PanelSection>
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'seat' && selected.value! ? (
          <>
            <PanelField label="Código técnico">
              <Input
                value={selected.value!.technicalCode}
                disabled={disabled}
                onChange={(event) => updateSeat(selected.value!.id, { technicalCode: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Nome exibido">
              <Input
                value={selected.value!.displayLabel}
                disabled={disabled}
                onChange={(event) => updateSeat(selected.value!.id, { displayLabel: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <div className={PANEL_GRID_CLASS}>
              <PanelField label="Fileira">
                <Input
                  value={selected.value!.rowLabel ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateSeat(selected.value!.id, { rowLabel: event.target.value || null })}
                  className={FIELD_CLASS}
                />
              </PanelField>
              <PanelField label="Número">
                <Input
                  value={selected.value!.seatNumber ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateSeat(selected.value!.id, { seatNumber: event.target.value || null })}
                  className={FIELD_CLASS}
                />
              </PanelField>
            </div>
            <PanelField label="Status">
              <MapPanelSelect
                value={selected.value!.status}
                disabled={disabled}
                options={EVENT_SEAT_STATUSES.map((statusOption) => ({
                  value: statusOption,
                  label: EVENT_SEAT_STATUS_LABELS[statusOption],
                }))}
                onValueChange={(value) =>
                  updateSeat(selected.value!.id, { status: value as EventSeatDTO['status'] })
                }
              />
            </PanelField>
            <div className={PANEL_GRID_CLASS}>
              <PanelField label="X">
                <Input type="number" value={selected.value!.x} disabled={disabled} onChange={(event) => updateSeat(selected.value!.id, { x: Number(event.target.value) })} className={FIELD_CLASS} />
              </PanelField>
              <PanelField label="Y">
                <Input type="number" value={selected.value!.y} disabled={disabled} onChange={(event) => updateSeat(selected.value!.id, { y: Number(event.target.value) })} className={FIELD_CLASS} />
              </PanelField>
            </div>
          </>
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'seatgroup' && selected.value && !seatedSector ? (
          <>
            <PanelSection title="Grupo de cadeiras">
              <PanelField label="Nome">
                <Input
                  value={selected.value.name ?? ''}
                  disabled={disabled}
                  onChange={(event) => updateSeatGroup(selected.value!.id, { name: event.target.value || null })}
                  className={FIELD_CLASS}
                />
              </PanelField>
              <div className={PANEL_GRID_CLASS}>
                <PanelField label="Fileiras">
                  <Input type="number" min={1} max={50} value={selected.value.rows} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { rows: Math.max(1, toNumber(event.target.value, selected.value!.rows)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Colunas">
                  <Input type="number" min={1} max={80} value={selected.value.columns} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { columns: Math.max(1, toNumber(event.target.value, selected.value!.columns)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Cadeira">
              <div className={PANEL_GRID_CLASS}>
                <PanelField label="Largura">
                  <Input type="number" min={8} value={selected.value.seatWidth} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { seatWidth: Math.max(8, toNumber(event.target.value, selected.value!.seatWidth)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Altura">
                  <Input type="number" min={8} value={selected.value.seatHeight} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { seatHeight: Math.max(8, toNumber(event.target.value, selected.value!.seatHeight)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
              <div className={PANEL_GRID_CLASS}>
                <PanelField label="Espaç. horizontal">
                  <Input type="number" min={0} value={selected.value.gapX} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { gapX: Math.max(0, toNumber(event.target.value, selected.value!.gapX)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Espaç. vertical">
                  <Input type="number" min={0} value={selected.value.gapY} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { gapY: Math.max(0, toNumber(event.target.value, selected.value!.gapY)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Posição">
              <div className={PANEL_GRID_CLASS}>
                <PanelField label="X">
                  <Input type="number" value={selected.value.x} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { x: toNumber(event.target.value, selected.value!.x) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Y">
                  <Input type="number" value={selected.value.y} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { y: toNumber(event.target.value, selected.value!.y) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
              <PanelField label="Rotação">
                <Input
                  type="number"
                  value={selected.value.rotation}
                  disabled={disabled}
                  onChange={(event) =>
                    rotateSeatGroupLikeCanvas(
                      selected.value!.id,
                      toNumber(event.target.value, 0),
                      selected.value!.rotation ?? 0,
                    )
                  }
                  className={FIELD_CLASS}
                />
              </PanelField>
            </PanelSection>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={disabled}
              className="w-full"
              onClick={() => deleteSeatGroup(selected.value!.id)}
            >
              Excluir grupo
            </Button>
          </>
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'object' && selected.value! ? (
          selected.value!.type === 'TEXT' ? (
            <TextProperties
              object={selected.value!}
              disabled={disabled}
              inlineEditorActive={inlineTextEditorActive}
              onUpdate={(patch) => updateObject(selected.value!.id, patch)}
            />
          ) : (
            <ObjectProperties
              object={selected.value!}
              disabled={disabled}
              onUpdate={(patch) => updateObject(selected.value!.id, patch)}
            />
          )
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'level' && selected.value! ? (
          <>
            <PanelField label="Nome" hint="O nome aparece nas abas públicas do mapa.">
              <Input
                value={selected.value!.name}
                disabled={disabled}
                onChange={(event) => updateLevel(selected.value!.id, { name: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <LevelArtboardProperties
              level={selected.value!}
              disabled={disabled}
              onUpdate={(patch) => updateLevelArtboard(selected.value!.id, patch)}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}
