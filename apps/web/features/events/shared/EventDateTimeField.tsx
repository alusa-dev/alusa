'use client';

import { useState } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { FILTER_INPUT_CLASS, TIME_OPTIONS, formatDateInputValue, toDateOnly, toTimeOnly } from './event-form-utils';

export function EventDateTimeField({
  name,
  defaultValue,
  required,
}: {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
}) {
  const [date, setDate] = useState<Date | undefined>(() => {
    const raw = toDateOnly(defaultValue);
    if (!raw) return undefined;
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  const [time, setTime] = useState(() => toTimeOnly(defaultValue));
  const dateValue = formatDateInputValue(date);
  const value = dateValue ? dateValue + 'T' + (time || '00:00') : '';

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]">
      <input type="hidden" name={name} value={value} required={required} />
      <DatePicker
        value={date}
        onChange={setDate}
        variant="input"
        placeholder="dd/mm/aaaa"
        className={FILTER_INPUT_CLASS}
        readOnlyInput
      />
      <Select value={time || undefined} onValueChange={setTime}>
        <SelectTrigger aria-label="Horário" className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-900 shadow-none">
          <SelectValue placeholder="--:--" />
        </SelectTrigger>
        <SelectContent className="max-h-72 text-[13px]">
          {TIME_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
