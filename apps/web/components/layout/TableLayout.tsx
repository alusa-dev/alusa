import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Layout reutilizável para páginas com tabela + header de filtros/ações.
 * Mantém consistência visual entre entidades.
 */
export interface TableLayoutProps {
  title: string;
  subtitle?: string;
  /** Conteúdo à direita do bloco de título (ex.: selo Asaas). Visível apenas a partir de `lg`. */
  headerEnd?: React.ReactNode;
  actions?: React.ReactNode; // barra de ações (botões, selects)
  filtersBar?: React.ReactNode; // área complementar (ex: busca)
  children: React.ReactNode; // tabela ou grid
  footer?: React.ReactNode; // paginação
  className?: string;
}

export function TableLayout({
  title,
  subtitle,
  headerEnd,
  actions,
  filtersBar,
  children,
  footer,
  className,
}: TableLayoutProps) {
  const hasToolbar = Boolean(actions) || Boolean(filtersBar);

  return (
    <div className={cn('alusa-session-panel w-full space-y-5', className)}>
      {/* space-y reduzido para aproximar seções e px-6 para alinhar com headers das tabelas */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>
        {headerEnd ? (
          <div className="hidden shrink-0 justify-start lg:flex lg:justify-end lg:pt-0.5">
            {headerEnd}
          </div>
        ) : null}
      </div>
      {hasToolbar ? (
        <div className="alusa-session-panel rounded-xl border border-slate-200 bg-white px-3 py-3 ring-0 ring-offset-0 focus-within:ring-0 focus-within:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:px-6 md:py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full shrink-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3 md:w-auto">
              {actions}
            </div>
            <div className="min-w-0 w-full flex-1 md:min-w-0 md:flex-1">{filtersBar}</div>
          </div>
        </div>
      ) : null}
      {children}
      {footer}
    </div>
  );
}

export default TableLayout;
