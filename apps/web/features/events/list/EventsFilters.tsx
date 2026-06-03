'use client';

import { Search } from 'lucide-react';
import { EVENT_STATUS_LABELS, EVENT_TYPE_LABELS } from '@alusa/shared';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { FILTER_INPUT_CLASS } from '../shared/event-form-utils';

export function EventsFilters({
  search,
  status,
  type,
  onSearchChange,
  onStatusChange,
  onTypeChange,
}: {
  search: string;
  status: string;
  type: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTypeChange: (value: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2">
      <div className="relative w-full min-w-0 shrink-0 lg:w-[360px] xl:w-[420px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nome ou local"
          className={cn(FILTER_INPUT_CLASS, 'pl-10')}
        />
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 lg:contents">
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-10 w-full min-w-0 border-slate-200 bg-white shadow-none lg:w-[170px]">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="ALL">Todos os status</SelectItem>
            {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={onTypeChange}>
          <SelectTrigger className="h-10 w-full min-w-0 border-slate-200 bg-white shadow-none lg:w-[170px]">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent align="end" className="text-[13px]">
            <SelectItem value="ALL">Todos os tipos</SelectItem>
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
