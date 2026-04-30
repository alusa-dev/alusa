import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Edit3, Trash2 } from '@/components/icons/icons';
import type { DataTableColumn } from '@/components/layout/DataTable';

interface StatusColumnOptions<T extends object> {
  id?: string;
  header?: React.ReactNode;
  getStatus?: (_item: T) => string | null | undefined;
  activeValue?: string;
  inactiveValue?: string;
  activeLabel?: string;
  inactiveLabel?: string;
  skeleton?: React.ReactNode;
  render?: (_item: T) => React.ReactNode;
}

export function statusColumn<T extends { status?: string }>(
  options: StatusColumnOptions<T> = {},
): DataTableColumn<T> {
  const {
    id = 'status',
    header = 'Status',
    getStatus = (item) => item.status ?? 'ATIVO',
    activeValue = 'ATIVO',
    inactiveValue = 'INATIVO',
    activeLabel = 'Ativo',
    inactiveLabel = 'Inativo',
    skeleton = <div className="h-6 w-16 rounded-full bg-gray-200 mx-auto" />,
    render,
  } = options;

  return {
    id,
    header,
    width: 'w-20',
    align: 'center',
    headerClassName: 'px-4',
    cellClassName: 'px-4',
    render:
      render ??
      ((item) => {
        const status = getStatus(item) ?? inactiveValue;
        const isActive = status === activeValue;
        return (
          <Badge variant={isActive ? 'success' : 'destructive'} size="sm">
            {isActive ? activeLabel : inactiveLabel}
          </Badge>
        );
      }),
    skeleton,
  } satisfies DataTableColumn<T>;
}

interface ActionsColumnOptions<T extends object> {
  id?: string;
  header?: React.ReactNode;
  onEdit?: (_item: T) => void;
  onDelete?: (_item: T) => void;
  editLabel?: string;
  deleteLabel?: string;
  editButtonAriaLabel?: (_item: T) => string;
  deleteButtonAriaLabel?: (_item: T) => string;
  editIcon?: React.ReactNode;
  deleteIcon?: React.ReactNode;
  skeleton?: React.ReactNode;
}

export function actionsColumn<T extends object>({
  id = 'acoes',
  header = 'Ações',
  onEdit,
  onDelete,
  editLabel = 'Editar',
  deleteLabel = 'Excluir',
  editButtonAriaLabel,
  deleteButtonAriaLabel,
  editIcon = <Edit3 className="h-4 w-4" />,
  deleteIcon = <Trash2 className="h-4 w-4" />,
  skeleton = (
    <div className="flex justify-center gap-2">
      <div className="h-8 w-8 bg-gray-200 rounded" />
      <div className="h-8 w-8 bg-gray-200 rounded" />
    </div>
  ),
}: ActionsColumnOptions<T> = {}): DataTableColumn<T> {
  return {
    id,
    header,
    width: 'w-24',
    align: 'center',
    headerClassName: 'px-4',
    cellClassName: 'px-4',
    render: (item) => (
      <div className="flex justify-center gap-2">
        {onEdit ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-600 hover:text-gray-800 hover:bg-gray-50"
            aria-label={editButtonAriaLabel ? editButtonAriaLabel(item) : editLabel}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item);
            }}
          >
            {editIcon}
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
            aria-label={deleteButtonAriaLabel ? deleteButtonAriaLabel(item) : deleteLabel}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item);
            }}
          >
            {deleteIcon}
          </Button>
        ) : null}
      </div>
    ),
    skeleton,
  } satisfies DataTableColumn<T>;
}
