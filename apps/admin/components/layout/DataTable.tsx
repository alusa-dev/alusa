import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DataTableColumn<T extends object> {
  id: string;
  header: ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  headerClassName?: string;
  cellClassName?: string;
  render: (_row: T) => ReactNode;
  noWrap?: boolean;
}

interface DataTableProps<T extends object> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (_row: T) => string;
  emptyMessage?: ReactNode;
  ariaLabel: string;
  containerClassName?: string;
  tableClassName?: string;
}

/**
 * Tabela administrativa padrão da Alusa.
 * Mantém a tabela plana, com cabeçalho neutro e rolagem horizontal responsiva.
 */
export function DataTable<T extends object>({
  columns,
  data,
  rowKey,
  emptyMessage = 'Nenhum registro encontrado.',
  ariaLabel,
  containerClassName,
  tableClassName,
}: DataTableProps<T>) {
  return (
    <div className={cn('admin-data-table', containerClassName)}>
      <table className={cn('admin-data-table-grid', tableClassName)} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  column.width,
                  column.align === 'center' && 'text-center',
                  column.align === 'right' && 'text-right',
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length > 0 ? (
            data.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      column.align === 'center' && 'text-center',
                      column.align === 'right' && 'text-right',
                      column.noWrap !== false && 'whitespace-nowrap',
                      column.cellClassName,
                    )}
                  >
                    {column.render(row)}
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
