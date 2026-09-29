import type { ReactNode } from 'react';

interface StepHeaderProps {
  title: string;
  hint?: string;
}

export function StepHeader({ title, hint }: StepHeaderProps) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
          {title}
        </h3>
        {hint ? (
          <p className="mt-0.5 text-[11px] text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface SectionCardProps {
  children: ReactNode;
  variant?: 'card' | 'open';
}

export function SectionCard({ children, variant = 'card' }: SectionCardProps) {
  if (variant === 'open') {
    return <div className="alusa-wizard-fields space-y-4">{children}</div>;
  }

  return (
    <div className="alusa-wizard-fields alusa-session-panel space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
      {children}
    </div>
  );
}
