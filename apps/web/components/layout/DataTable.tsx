import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type SortDirection = 'ASC' | 'DESC';

export interface DataTableColumn<T extends object> {
  id: string;
  header: React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
  render?: (_row: T) => React.ReactNode;
  skeleton?: React.ReactNode;
  noWrap?: boolean;
}

export interface DataTableProps<T extends object> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (_row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: React.ReactNode;
  tableClassName?: string;
  bodyClassName?: string;
  ariaLabel?: string;
  sort?: { direction: SortDirection; columnId?: string };
  onSortChange?: (_columnId: string) => void;
  onRowClick?: (_row: T) => void;
}

/**
 * Tabela no estilo "Gestão de Alunos"
 * - Flat, sem sombra
 * - Cabeçalho leve
 * - Colunas alinhadas corretamente
 */
export function DataTable<T extends object>({
  columns,
  data,
  rowKey,
  loading,
  skeletonRows = 5,
  emptyMessage = (
    <div className="px-6 py-12 text-center text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
      Nenhum registro encontrado
    </div>
  ),
  tableClassName,
  bodyClassName,
  ariaLabel,
  sort,
  onSortChange,
  onRowClick,
}: DataTableProps<T>) {
  const hasData = data.length > 0;

  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn(
          'w-full table-fixed border-collapse bg-white alusa-dark:bg-[color:var(--color-bg-card)]',
          tableClassName,
        )}
        aria-label={ariaLabel}
      >
        <thead className="bg-gray-50 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
          <tr>
            {columns.map((col) => {
              const isSorted = sort?.columnId === col.id;
              const ariaSort = isSorted
                ? sort?.direction === 'ASC'
                  ? 'ascending'
                  : 'descending'
                : 'none';
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={ariaSort as React.AriaAttributes['aria-sort']}
                  className={cn(
                    'px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide alusa-dark:text-[color:var(--color-text-secondary)] md:px-6 md:py-3',
                    col.width,
                    col.align === 'center' && 'text-center',
                    col.align === 'right' && 'text-right',
                    col.align === 'left' && 'text-left',
                    col.headerClassName,
                    col.sortable &&
                      'cursor-pointer select-none hover:text-gray-700 alusa-dark:hover:text-[color:var(--color-text-primary)]',
                  )}
                  onClick={() => {
                    if (!col.sortable || !onSortChange) return;
                    onSortChange(col.id);
                  }}
                >
                  {col.header}
                  {col.sortable && isSorted && (
                    <span aria-hidden className="ml-1 text-[10px] text-brand-600">
                      {sort?.direction === 'ASC' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody
          className={cn(
            'divide-y divide-gray-200 text-sm text-gray-700 alusa-dark:divide-[color:var(--color-border-default)] alusa-dark:text-[color:var(--color-text-primary)]',
            bodyClassName,
          )}
        >
          {loading ? (
            [...Array(skeletonRows)].map((_, idx) => (
              <tr key={idx} className="bg-white alusa-dark:bg-[color:var(--color-bg-card)]">
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-3 py-3 align-middle md:px-6 md:py-4',
                      col.width,
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                      col.align === 'left' && 'text-left',
                      col.cellClassName,
                    )}
                  >
                    {col.skeleton || <Skeleton className="h-4 w-3/4 rounded" />}
                  </td>
                ))}
              </tr>
            ))
          ) : hasData ? (
            data.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'bg-white transition-colors hover:bg-gray-50 alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.04)]',
                  onRowClick && 'cursor-pointer'
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-3 py-3 align-middle text-sm leading-5 text-gray-700 alusa-dark:text-[color:var(--color-text-primary)] md:px-6 md:py-4',
                      col.width,
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                      col.noWrap === false ? '' : 'whitespace-nowrap',
                      col.cellClassName,
                    )}
                  >
                    {col.render ? col.render(row) : null}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
