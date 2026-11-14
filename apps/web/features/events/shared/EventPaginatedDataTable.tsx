'use client';

import { useMemo, useState } from 'react';

import DataTable, { type DataTableProps } from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';

import { EventTablePanel } from './EventTablePanel';

export const EVENT_TABLE_PAGE_SIZE = 6;

type EventPaginatedDataTableProps<T extends object> = Omit<DataTableProps<T>, 'paginate' | 'pageSize'> & {
  pageSize?: number;
};

export function EventPaginatedDataTable<T extends object>({
  data,
  pageSize = EVENT_TABLE_PAGE_SIZE,
  ...tableProps
}: EventPaginatedDataTableProps<T>) {
  const total = data.length;
  const [pagination, setPagination] = useState({ total, pageSize, page: 1 });
  let page = pagination.page;
  if (pagination.total !== total || pagination.pageSize !== pageSize) {
    page = 1;
    setPagination({ total, pageSize, page });
  }

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, page, pageSize]);

  return (
    <EventTablePanel>
      <DataTable {...tableProps} data={paginatedData} />
      {total > 0 ? (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onChange={(nextPage) => setPagination({ total, pageSize, page: nextPage })}
            hideIfSinglePage={false}
          />
        </div>
      ) : null}
    </EventTablePanel>
  );
}
