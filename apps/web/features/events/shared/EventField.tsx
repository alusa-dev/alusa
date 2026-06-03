'use client';

import type { ReactNode } from 'react';

import { LABEL_CLASS } from './event-form-utils';

export function EventField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}
