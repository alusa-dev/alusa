import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onChange: (_p: number) => void;
  className?: string;
  hideIfSinglePage?: boolean;
}

export function Pagination({
  total,
  page,
  pageSize,
  onChange,
  className,
  hideIfSinglePage = true,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages = useMemo<(number | '…')[]>(() => {
    if (totalPages <= 1) return [1];
    const maxButtons = 7;
    if (totalPages <= maxButtons + 2) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const siblings = 2;
    const left = Math.max(2, page - siblings);
    const right = Math.min(totalPages - 1, page + siblings);
    const list: (number | '…')[] = [1];
    if (left > 2) list.push('…');
    for (let i = left; i <= right; i++) list.push(i);
    if (right < totalPages - 1) list.push('…');
    if (totalPages > 1) list.push(totalPages);
    return list;
  }, [page, totalPages]);

  if (total <= 0) return null;
  if (hideIfSinglePage && totalPages <= 1) return null;
  if (page > totalPages) setTimeout(() => onChange(totalPages), 0);

  return (
    <nav
      aria-label="Paginação"
      className={cn('flex min-h-9 flex-col items-center justify-between gap-3 sm:flex-row', className)}
    >
      <div className="text-xs font-medium text-gray-500">Página {page} de {totalPages}</div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <PaginationTextButton
          aria-label="Página anterior"
          disabled={page === 1}
          onClick={() => onChange(Math.max(1, page - 1))}
        >
          <span aria-hidden>‹</span>
          <span>Anterior</span>
        </PaginationTextButton>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={i} className="grid h-9 min-w-9 place-items-center px-1 text-sm font-semibold text-gray-400">
              …
            </span>
          ) : (
            <PageBtn
              key={p}
              aria-current={p === page ? 'page' : undefined}
              active={p === page}
              onClick={() => onChange(p)}
            >
              {p}
            </PageBtn>
          ),
        )}
        <PaginationTextButton
          aria-label="Próxima página"
          disabled={page === totalPages}
          onClick={() => onChange(Math.min(totalPages, page + 1))}
        >
          <span>Próxima</span>
          <span aria-hidden>›</span>
        </PaginationTextButton>
      </div>
    </nav>
  );
}

interface PageBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
}
function PageBtn({ children, onClick, disabled, active, label, ...rest }: PageBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-8 min-w-8 place-items-center rounded-full border px-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30',
        active
          ? 'border-transparent bg-gray-200 text-gray-900 hover:bg-gray-200'
          : 'border-transparent bg-transparent text-gray-700 hover:bg-white hover:text-brand-accent disabled:opacity-40',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function PaginationTextButton({ children, onClick, disabled, ...rest }: PageBtnProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-semibold text-gray-700 transition hover:bg-white hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300"
      {...rest}
    >
      {children}
    </button>
  );
}

export default Pagination;
