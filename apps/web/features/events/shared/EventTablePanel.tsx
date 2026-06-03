'use client';

import type { ReactNode } from 'react';

export function EventTablePanel({ children }: { children: ReactNode }) {
  return (
    <div className="alusa-session-panel w-full overflow-hidden rounded-lg border border-slate-200 bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
      {children}
    </div>
  );
}
