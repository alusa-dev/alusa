'use client';

import { cn } from '@/lib/utils';

import { formatDate, type EventResources } from '../events-service';
import { SELECT_CLASS } from './event-form-utils';

export function EventSelector({ value, onChange, resources }: { value?: string; onChange: (value: string) => void; resources?: EventResources }) {
  const options = resources?.events ?? [];
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={cn(SELECT_CLASS, 'min-w-72')}>
      <option value="">Selecione um evento</option>
      {options.map((event) => (
        <option key={event.id} value={event.id}>{event.name} · {formatDate(event.startsAt)}</option>
      ))}
    </select>
  );
}
