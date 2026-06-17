'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { MAP_PANEL_SELECT_TRIGGER_CLASS } from './text-format-options';

export type MapPanelSelectOption = {
  value: string;
  label: string;
};

export function MapPanelSelect({
  value,
  options,
  disabled,
  placeholder = 'Selecionar',
  onValueChange,
  className,
}: {
  value: string;
  options: MapPanelSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={cn(MAP_PANEL_SELECT_TRIGGER_CLASS, className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="text-sm">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Radix Select não aceita value vazio — use este sentinel para opção "nenhum". */
export const MAP_PANEL_SELECT_NONE_VALUE = '__none__';

export function mapNullableSelectValue(value: string | null | undefined) {
  return value && value.length > 0 ? value : MAP_PANEL_SELECT_NONE_VALUE;
}

export function mapNullableSelectChange(value: string) {
  return value === MAP_PANEL_SELECT_NONE_VALUE ? null : value;
}
