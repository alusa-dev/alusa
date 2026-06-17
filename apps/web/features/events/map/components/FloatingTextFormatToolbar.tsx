'use client';

import { getTextDecorationParts } from '@alusa/domain';
import type { EventMapObjectDTO } from '../api/event-map-service';

import { cn } from '@/lib/utils';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Strikethrough,
  Underline,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import { MAP_TEXT_FIELD_CLASS, MAP_TEXT_FONT_OPTIONS } from './text-format-options';

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function FormatToggleButton({
  active,
  disabled,
  label,
  children,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'h-8 w-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100',
            active && 'border-brand-accent bg-brand-accent text-white hover:bg-brand-accent hover:text-white',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function FloatingTextFormatToolbar({
  object,
  disabled,
  onUpdate,
}: {
  object: EventMapObjectDTO;
  disabled?: boolean;
  onUpdate: (patch: Partial<EventMapObjectDTO>) => void;
}) {
  const data = object.data;
  const { underline, lineThrough } = getTextDecorationParts(data);
  const fontSize = numberValue(typeof data.fontSize === 'number' ? data.fontSize : Number(data.fontSize), 22);
  const fontFamily = String(data.fontFamily ?? 'Inter, sans-serif');
  const align = String(data.align ?? 'left');

  function updateData(patch: Record<string, unknown>) {
    onUpdate({ data: { ...object.data, ...patch } });
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
    <TooltipProvider>
      <div
        data-testid="text-format-toolbar"
        className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-lg shadow-slate-300/30 backdrop-blur"
      >
        <Select
          value={fontFamily}
          disabled={disabled}
          onValueChange={(value) => updateData({ fontFamily: value })}
        >
          <SelectTrigger className={cn(MAP_TEXT_FIELD_CLASS, 'h-9 w-[7.5rem] px-2')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="center" className="text-[13px]">
            {MAP_TEXT_FONT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          min={1}
          value={fontSize}
          disabled={disabled}
          aria-label="Tamanho da fonte"
          onChange={(event) => updateData({ fontSize: Math.max(1, toNumber(event.target.value, fontSize)) })}
          className={cn(MAP_TEXT_FIELD_CLASS, 'h-9 w-14 px-2 text-center')}
        />

        <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden />

        <FormatToggleButton
          active={data.fontWeight === 'bold'}
          disabled={Boolean(disabled)}
          label="Negrito"
          onClick={() => updateData({ fontWeight: data.fontWeight === 'bold' ? 'normal' : 'bold' })}
        >
          <Bold className="h-4 w-4" />
        </FormatToggleButton>
        <FormatToggleButton
          active={Boolean(data.italic)}
          disabled={Boolean(disabled)}
          label="Itálico"
          onClick={() => updateData({ italic: !data.italic })}
        >
          <Italic className="h-4 w-4" />
        </FormatToggleButton>
        <FormatToggleButton
          active={underline}
          disabled={Boolean(disabled)}
          label="Sublinhado"
          onClick={() => toggleDecoration('underline')}
        >
          <Underline className="h-4 w-4" />
        </FormatToggleButton>
        <FormatToggleButton
          active={lineThrough}
          disabled={Boolean(disabled)}
          label="Tachado"
          onClick={() => toggleDecoration('lineThrough')}
        >
          <Strikethrough className="h-4 w-4" />
        </FormatToggleButton>

        <span className="mx-0.5 h-6 w-px bg-slate-200" aria-hidden />

        <FormatToggleButton
          active={align === 'left'}
          disabled={Boolean(disabled)}
          label="Alinhar à esquerda"
          onClick={() => updateData({ align: 'left' })}
        >
          <AlignLeft className="h-4 w-4" />
        </FormatToggleButton>
        <FormatToggleButton
          active={align === 'center'}
          disabled={Boolean(disabled)}
          label="Centralizar"
          onClick={() => updateData({ align: 'center' })}
        >
          <AlignCenter className="h-4 w-4" />
        </FormatToggleButton>
        <FormatToggleButton
          active={align === 'right'}
          disabled={Boolean(disabled)}
          label="Alinhar à direita"
          onClick={() => updateData({ align: 'right' })}
        >
          <AlignRight className="h-4 w-4" />
        </FormatToggleButton>
      </div>
    </TooltipProvider>
  );
}
