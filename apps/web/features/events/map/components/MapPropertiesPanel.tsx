'use client';
import { MAP_AREA_HEIGHT_PX, MAP_AREA_WIDTH_PX, TEXT_MODE_LABELS, applyTextModePatch, getPrimarySelection, getSelectableItems, getTextDecorationParts, getTextMode, normalizeRotation } from '@alusa/domain';
import type { TextMode } from '@alusa/domain';
import type { TicketLotDTO } from '../../events-service';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

import { cn } from '@/lib/utils';

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Strikethrough, Underline } from 'lucide-react';

import { EVENT_SEAT_STATUS_LABELS, EVENT_SEAT_STATUSES } from '@alusa/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

const FIELD_CLASS = 'h-9 rounded-lg border-slate-200 bg-white text-sm shadow-none';
const COLOR_INPUT_CLASS = 'h-9 w-11 shrink-0 rounded-lg border border-slate-200 bg-white p-1';

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
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
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function ToggleButton({ active, disabled, label, children, onClick }: { active: boolean; disabled: boolean; label: string; children: ReactNode; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('h-8 w-8 rounded-md border border-slate-200 text-slate-600', active && 'border-brand-accent bg-brand-accent text-white hover:bg-brand-accent hover:text-white')}
    >
      {children}
    </Button>
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
  const { underline, lineThrough } = getTextDecorationParts(data);
  const fill = String(data.fill ?? '#0f172a');
  const stroke = String(data.stroke ?? '#000000');
  const strokeWidth = numberValue(typeof data.strokeWidth === 'number' ? data.strokeWidth : Number(data.strokeWidth), 0);
  const opacity = numberValue(typeof data.opacity === 'number' ? data.opacity : Number(data.opacity), 1);
  const fontSize = numberValue(typeof data.fontSize === 'number' ? data.fontSize : Number(data.fontSize), 22);
  const fontFamily = String(data.fontFamily ?? 'Inter, sans-serif');
  const align = String(data.align ?? 'left');
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

  function toggleDecoration(key: 'underline' | 'lineThrough') {
    const next = { ...getTextDecorationParts(data) };
    next[key] = !next[key];
    updateData({
      underline: next.underline,
      lineThrough: next.lineThrough,
      textDecoration: undefined,
    });
  }

  return (
    <>
      <PanelSection title="Texto">
        <PanelField label="Modo">
          <select
            value={textMode}
            disabled={disabled}
            onChange={(event) => setTextMode(event.target.value as TextMode)}
            className={cn(FIELD_CLASS, 'w-full px-3')}
          >
            {(Object.entries(TEXT_MODE_LABELS) as [TextMode, string][]).map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </PanelField>
        <PanelField label="Conteúdo">
          <textarea
            value={String(data.text ?? '')}
            disabled={contentDisabled}
            onChange={(event) => updateData({ text: event.target.value, label: event.target.value })}
            className={cn(FIELD_CLASS, 'min-h-24 w-full resize-none px-3 py-2')}
          />
          {inlineEditorActive ? (
            <p className="text-xs text-slate-500">Edição em andamento no canvas.</p>
          ) : null}
        </PanelField>
      </PanelSection>

      <PanelSection title="Dimensão">
        <div className="grid grid-cols-2 gap-3">
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
        <PanelField label="Fonte">
          <select value={fontFamily} disabled={disabled} onChange={(event) => updateData({ fontFamily: event.target.value })} className={cn(FIELD_CLASS, 'w-full px-3')}>
            <option value="Inter, sans-serif">Inter</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Helvetica, Arial, sans-serif">Helvetica</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Times New Roman', serif">Times New Roman</option>
            <option value="'Courier New', monospace">Courier New</option>
          </select>
        </PanelField>

        <div className="grid grid-cols-2 gap-3">
          <PanelField label="Tamanho"><Input type="number" min={1} value={fontSize} disabled={disabled} onChange={(event) => updateData({ fontSize: Math.max(1, toNumber(event.target.value, fontSize)) })} className={FIELD_CLASS} /></PanelField>
          <PanelField label="Linha"><Input type="number" min={0.5} step={0.1} value={lineHeight} disabled={disabled} onChange={(event) => updateData({ lineHeight: Math.max(0.5, toNumber(event.target.value, lineHeight)) })} className={FIELD_CLASS} /></PanelField>
          <PanelField label="Espaçamento"><Input type="number" value={letterSpacing} disabled={disabled} onChange={(event) => updateData({ letterSpacing: toNumber(event.target.value, letterSpacing) })} className={FIELD_CLASS} /></PanelField>
        </div>

        <div className="flex flex-wrap gap-2">
          <ToggleButton active={data.fontWeight === 'bold'} disabled={disabled} label="Negrito" onClick={() => updateData({ fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' })}><Bold className="h-4 w-4" /></ToggleButton>
          <ToggleButton active={Boolean(data.italic)} disabled={disabled} label="Itálico" onClick={() => updateData({ italic: !data.italic })}><Italic className="h-4 w-4" /></ToggleButton>
          <ToggleButton active={underline} disabled={disabled} label="Sublinhado" onClick={() => toggleDecoration('underline')}><Underline className="h-4 w-4" /></ToggleButton>
          <ToggleButton active={lineThrough} disabled={disabled} label="Tachado" onClick={() => toggleDecoration('lineThrough')}><Strikethrough className="h-4 w-4" /></ToggleButton>
        </div>

        <div className="flex flex-wrap gap-2">
          <ToggleButton active={align === 'left'} disabled={disabled} label="Alinhar à esquerda" onClick={() => updateData({ align: 'left' })}><AlignLeft className="h-4 w-4" /></ToggleButton>
          <ToggleButton active={align === 'center'} disabled={disabled} label="Centralizar" onClick={() => updateData({ align: 'center' })}><AlignCenter className="h-4 w-4" /></ToggleButton>
          <ToggleButton active={align === 'right'} disabled={disabled} label="Alinhar à direita" onClick={() => updateData({ align: 'right' })}><AlignRight className="h-4 w-4" /></ToggleButton>
          <select value={verticalAlign} disabled={disabled || textMode === 'auto'} onChange={(event) => updateData({ verticalAlign: event.target.value })} className={cn(FIELD_CLASS, 'w-28 px-2 text-xs')}>
            <option value="top">Topo</option>
            <option value="middle">Meio</option>
            <option value="bottom">Base</option>
          </select>
        </div>
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
  const opacity = numberValue(typeof object.data.opacity === 'number' ? object.data.opacity : Number(object.data.opacity), object.type === 'SECTION' ? 0.15 : 1);
  const cornerRadius = numberValue(typeof object.data.cornerRadius === 'number' ? object.data.cornerRadius : Number(object.data.cornerRadius), object.type === 'TABLE' ? 999 : object.data.shape ? 0 : 8);
  const seatGapTop = numberValue(typeof object.data.seatGapTop === 'number' ? object.data.seatGapTop : Number(object.data.seatGapTop), 8);
  const seatGapRight = numberValue(typeof object.data.seatGapRight === 'number' ? object.data.seatGapRight : Number(object.data.seatGapRight), 8);
  const seatGapBottom = numberValue(typeof object.data.seatGapBottom === 'number' ? object.data.seatGapBottom : Number(object.data.seatGapBottom), 8);
  const seatGapLeft = numberValue(typeof object.data.seatGapLeft === 'number' ? object.data.seatGapLeft : Number(object.data.seatGapLeft), 8);
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
        <div className="grid grid-cols-2 gap-3">
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
          <PanelSection title="Espaçamento dos assentos">
          <div className="grid grid-cols-2 gap-3">
            <PanelField label="Superior">
              <Input
                data-testid="corridor-seat-gap-top"
                type="number"
                min={0}
                value={seatGapTop}
                disabled={disabled}
                onChange={(event) => updateData({ seatGapTop: Math.max(0, toNumber(event.target.value, seatGapTop)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Direita">
              <Input
                data-testid="corridor-seat-gap-right"
                type="number"
                min={0}
                value={seatGapRight}
                disabled={disabled}
                onChange={(event) => updateData({ seatGapRight: Math.max(0, toNumber(event.target.value, seatGapRight)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Inferior">
              <Input
                data-testid="corridor-seat-gap-bottom"
                type="number"
                min={0}
                value={seatGapBottom}
                disabled={disabled}
                onChange={(event) => updateData({ seatGapBottom: Math.max(0, toNumber(event.target.value, seatGapBottom)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Esquerda">
              <Input
                data-testid="corridor-seat-gap-left"
                type="number"
                min={0}
                value={seatGapLeft}
                disabled={disabled}
                onChange={(event) => updateData({ seatGapLeft: Math.max(0, toNumber(event.target.value, seatGapLeft)) })}
                className={FIELD_CLASS}
              />
            </PanelField>
          </div>
          <p className="text-xs text-slate-500">Define a folga mínima entre o corpo do corredor e os assentos.</p>
        </PanelSection>
      ) : null}

      <PanelSection title="Aparência">
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

        <div className="grid grid-cols-2 gap-3">
          <PanelToggleField
            label="Espessura"
            enabled={strokeWidthEnabled}
            disabled={disabled}
            onEnabledChange={(enabled) => updateData({ strokeWidthEnabled: enabled })}
          >
            <Input type="number" min={0} value={strokeWidth} disabled={disabled || !strokeWidthEnabled} onChange={(event) => updateData({ strokeWidth: Math.max(0, toNumber(event.target.value, strokeWidth)) })} className={FIELD_CLASS} />
          </PanelToggleField>
          <PanelField label="Estilo">
            <select
              value={strokeStyle}
              disabled={disabled || !strokeControlsEnabled}
              onChange={(event) => updateData({ strokeStyle: event.target.value })}
              className={cn(FIELD_CLASS, 'w-full px-3', !strokeControlsEnabled && 'opacity-50')}
            >
              <option value="solid">Sólido</option>
              <option value="dashed">Tracejado</option>
              <option value="dotted">Pontilhado</option>
            </select>
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
  const updateSeatGroup = useEventMapEditorStore((state) => state.updateSeatGroup);
  const deleteSeatGroup = useEventMapEditorStore((state) => state.deleteSeatGroup);
  const inlineTextEditorActive = useEventMapEditorStore((state) => state.inlineTextEditorActive);
  const disabled = status === 'ARCHIVED';

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

  const multiSelectCount = getSelectableItems(selection).length;

  return (
    <aside
      data-testid="properties-panel"
      className="absolute right-4 top-24 z-20 flex max-h-[calc(100%-8rem)] w-80 flex-col rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-950">Propriedades</h2>
        <p className="text-xs text-slate-500">Configurações do item selecionado</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {multiSelectCount > 1 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-900">{multiSelectCount} itens selecionados</p>
            <p className="mt-1 text-xs text-slate-500">
              Mova, duplique ou exclua em lote. Use ⌘/Ctrl + G para agrupar e ⌘/Ctrl + U para desagrupar.
            </p>
          </div>
        ) : null}

        {!selected?.value ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Selecione uma prancheta, setor, cadeira ou objeto para editar propriedades.
          </div>
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'section' && selected.value! ? (
          <>
            <PanelField label="Nome do setor">
              <Input
                value={selected.value!.name}
                disabled={disabled}
                onChange={(event) => updateSection(selected.value!.id, { name: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <PanelField label="Cor">
              <div className="flex gap-2">
                <input
                  type="color"
                  value={selected.value!.color}
                  disabled={disabled}
                  onChange={(event) => updateSection(selected.value!.id, { color: event.target.value })}
                  className="h-9 w-12 rounded-lg border border-slate-200 bg-white p-1"
                />
                <Input
                  value={selected.value!.color}
                  disabled={disabled}
                  onChange={(event) => updateSection(selected.value!.id, { color: event.target.value })}
                  className={FIELD_CLASS}
                />
              </div>
            </PanelField>
            <PanelField label="Lote vinculado">
              <select
                value={selected.value!.lotId ?? ''}
                disabled={disabled}
                onChange={(event) => updateSection(selected.value!.id, { lotId: event.target.value || null })}
                className={cn(FIELD_CLASS, 'w-full px-3')}
              >
                <option value="">Sem lote</option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name}
                  </option>
                ))}
              </select>
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
          </>
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
            <div className="grid grid-cols-2 gap-3">
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
              <select
                value={selected.value!.status}
                disabled={disabled}
                onChange={(event) => updateSeat(selected.value!.id, { status: event.target.value as EventSeatDTO['status'] })}
                className={cn(FIELD_CLASS, 'w-full px-3')}
              >
                {EVENT_SEAT_STATUSES.map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {EVENT_SEAT_STATUS_LABELS[statusOption]}
                  </option>
                ))}
              </select>
            </PanelField>
            <div className="grid grid-cols-2 gap-3">
              <PanelField label="X">
                <Input type="number" value={selected.value!.x} disabled={disabled} onChange={(event) => updateSeat(selected.value!.id, { x: Number(event.target.value) })} className={FIELD_CLASS} />
              </PanelField>
              <PanelField label="Y">
                <Input type="number" value={selected.value!.y} disabled={disabled} onChange={(event) => updateSeat(selected.value!.id, { y: Number(event.target.value) })} className={FIELD_CLASS} />
              </PanelField>
            </div>
          </>
        ) : null}

        {multiSelectCount <= 1 && selected?.type === 'seatgroup' && selected.value ? (
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
              <div className="grid grid-cols-2 gap-3">
                <PanelField label="Fileiras">
                  <Input type="number" min={1} max={50} value={selected.value.rows} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { rows: Math.max(1, toNumber(event.target.value, selected.value!.rows)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Colunas">
                  <Input type="number" min={1} max={80} value={selected.value.columns} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { columns: Math.max(1, toNumber(event.target.value, selected.value!.columns)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Cadeira">
              <div className="grid grid-cols-2 gap-3">
                <PanelField label="Largura">
                  <Input type="number" min={8} value={selected.value.seatWidth} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { seatWidth: Math.max(8, toNumber(event.target.value, selected.value!.seatWidth)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Altura">
                  <Input type="number" min={8} value={selected.value.seatHeight} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { seatHeight: Math.max(8, toNumber(event.target.value, selected.value!.seatHeight)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PanelField label="Espaç. horizontal">
                  <Input type="number" min={0} value={selected.value.gapX} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { gapX: Math.max(0, toNumber(event.target.value, selected.value!.gapX)) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Espaç. vertical">
                  <Input type="number" min={0} value={selected.value.gapY} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { gapY: Math.max(0, toNumber(event.target.value, selected.value!.gapY)) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
            </PanelSection>
            <PanelSection title="Posição">
              <div className="grid grid-cols-2 gap-3">
                <PanelField label="X">
                  <Input type="number" value={selected.value.x} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { x: toNumber(event.target.value, selected.value!.x) })} className={FIELD_CLASS} />
                </PanelField>
                <PanelField label="Y">
                  <Input type="number" value={selected.value.y} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { y: toNumber(event.target.value, selected.value!.y) })} className={FIELD_CLASS} />
                </PanelField>
              </div>
              <PanelField label="Rotação">
                <Input type="number" value={selected.value.rotation} disabled={disabled} onChange={(event) => updateSeatGroup(selected.value!.id, { rotation: toNumber(event.target.value, 0) })} className={FIELD_CLASS} />
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
            <PanelField label="Nome">
              <Input
                value={selected.value!.name}
                disabled={disabled}
                onChange={(event) => updateLevel(selected.value!.id, { name: event.target.value })}
                className={FIELD_CLASS}
              />
            </PanelField>
            <p className="text-xs text-slate-500">O nome aparece nas abas públicas do mapa.</p>
            <div className="grid grid-cols-2 gap-3">
              <PanelField label="Largura">
                <Input type="number" value={MAP_AREA_WIDTH_PX} disabled className={FIELD_CLASS} />
              </PanelField>
              <PanelField label="Altura">
                <Input type="number" value={MAP_AREA_HEIGHT_PX} disabled className={FIELD_CLASS} />
              </PanelField>
            </div>
            <p className="text-xs text-slate-500">Tamanho fixo de prancheta web desktop.</p>
          </>
        ) : null}
      </div>
    </aside>
  );
}
