'use client';

import { Button } from '@/components/ui/button';
import type { ExtratoPagination } from '../dtos';

interface ExtratoTablePaginationProps {
  pagination: ExtratoPagination;
  onPageChange: (page: number) => void;
}

export function ExtratoTablePagination({ pagination, onPageChange }: ExtratoTablePaginationProps) {
  if (pagination.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50/50" role="navigation">
      <span className="text-xs text-gray-500 font-medium">
        Página {pagination.page} de {pagination.totalPages} • {pagination.totalItems} movimentações
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={!pagination.hasNextPage}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
