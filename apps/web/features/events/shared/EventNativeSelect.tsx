'use client';

import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type EventSelectOption = { value: string; label: string };

const EMPTY_SELECT_VALUE = '__EVENTS_EMPTY__';

export function EventNativeSelect({
  name,
  value,
  defaultValue,
  options,
  required,
  placeholder,
  onValueChange,
}: {
  name: string;
  value?: string | null;
  defaultValue?: string | null;
  options: EventSelectOption[];
  required?: boolean;
  placeholder?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? '');
  const selectedValue = value ?? internalValue;
  return (
    <>
      <input type="hidden" name={name} value={selectedValue} required={required} />
      <Select
        value={selectedValue || undefined}
        onValueChange={(next) => {
          const val = next === EMPTY_SELECT_VALUE ? '' : next ?? '';
          if (value == null) setInternalValue(val);
          onValueChange?.(val);
        }}
      >
        <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-900 shadow-none">
          <SelectValue placeholder={placeholder ?? 'Selecione'} />
        </SelectTrigger>
        <SelectContent className="text-[13px]">
          {placeholder && !required ? <SelectItem value={EMPTY_SELECT_VALUE}>{placeholder}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
