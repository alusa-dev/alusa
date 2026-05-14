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
    const siblings = 1;
    const left = Math.max(2, page - siblings);
    const right = Math.min(totalPages - 1, page + siblings);
    const list: (number | '…')[] = [1];
    if (left > 2) list.push('…');
    for (let i = left; i <= right; i++) list.push(i);
    if (right < totalPages - 1) list.push('…');
    if (totalPages > 1) list.push(totalPages);
    return list;
  }, [page, totalPages]);

  if (hideIfSinglePage && totalPages <= 1) return null;
  if (page > totalPages) setTimeout(() => onChange(totalPages), 0);

  return (
    <nav aria-label="Paginação" className={className + ' flex justify-center pt-4'}>
      <div className="flex items-center gap-2 text-sm">
        <PageBtn label="Primeira" disabled={page === 1} onClick={() => onChange(1)}>
          «
        </PageBtn>
        <PageBtn
          label="Anterior"
          disabled={page === 1}
          onClick={() => onChange(Math.max(1, page - 1))}
        >
          ‹
        </PageBtn>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={i} className="px-2 text-brand-accent/40">
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
        <PageBtn
          label="Próxima"
          disabled={page === totalPages}
          onClick={() => onChange(Math.min(totalPages, page + 1))}
        >
          ›
        </PageBtn>
        <PageBtn label="Última" disabled={page === totalPages} onClick={() => onChange(totalPages)}>
          »
        </PageBtn>
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
        'grid h-8 w-8 place-items-center rounded-md border text-[13px] transition',
        active
          ? 'border-brand-accent bg-brand-accent text-white'
          : 'border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white alusa-dark:bg-[color:var(--color-bg-card-soft)] disabled:opacity-40',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Pagination;
