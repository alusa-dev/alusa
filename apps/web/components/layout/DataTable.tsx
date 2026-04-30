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
    <div className="px-6 py-12 text-center text-gray-500 text-sm">Nenhum registro encontrado</div>
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
        className={cn('w-full border-collapse bg-white', tableClassName)}
        aria-label={ariaLabel}
      >
        <thead className="bg-gray-50">
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
                    'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide',
                    col.width,
                    col.align === 'center' && 'text-center',
                    col.align === 'right' && 'text-right',
                    col.align === 'left' && 'text-left',
                    col.headerClassName,
                    col.sortable && 'cursor-pointer select-none hover:text-gray-700',
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

        <tbody className={cn('divide-y divide-gray-200 text-sm text-gray-700', bodyClassName)}>
          {loading ? (
            [...Array(skeletonRows)].map((_, idx) => (
              <tr key={idx} className="bg-white">
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-6 py-4 align-middle',
                      col.width,
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                      col.align === 'left' && 'text-left',
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
                  'bg-white hover:bg-gray-50 transition-colors',
                  onRowClick && 'cursor-pointer'
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-6 py-4 align-middle text-sm leading-5 text-gray-700',
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
