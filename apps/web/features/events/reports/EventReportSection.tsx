import type { ReactNode } from 'react';

/** Section styling for the event report's editorial, chapter-based layout. */
export function EventReportSection({
  id,
  title,
  description,
  children,
  className = '',
  headerClassName = '',
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`min-w-0 rounded-2xl bg-gray-50 p-5 sm:p-6 alusa-dark:bg-[color:var(--color-bg-card-soft)] ${className}`}
    >
      <header className={`mb-5 space-y-1.5 ${headerClassName}`}>
        <div>
          <h2
            id={`${id}-title`}
            className="text-lg font-semibold tracking-tight text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]"
          >
            {title}
          </h2>
        </div>
        {description ? (
          <p className="max-w-4xl text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
