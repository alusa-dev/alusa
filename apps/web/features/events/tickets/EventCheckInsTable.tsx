'use client';

import { formatDateTime, type EventCheckInDTO } from '../events-service';
import { EventEmptyState } from '../shared/EventEmptyState';
import DataTable from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';
import { EventTablePanel } from '../shared/EventTablePanel';

export function EventCheckInsTable({
  checkIns, total, page, pageSize, onPageChange, loading,
}: {
  checkIns: EventCheckInDTO[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading: boolean;
}) {
  void page;
  return (
    <EventTablePanel>
      <DataTable
        columns={[
          { id: 'buyer', header: 'Comprador', width: 'w-[22%]', align: 'left', render: (row: EventCheckInDTO) => <div><span className="block font-medium text-slate-950">{row.buyerName}</span>{row.buyerEmail ? <span className="block truncate text-xs text-slate-500">{row.buyerEmail}</span> : null}</div> },
          { id: 'session', header: 'Mapa/Sessão', width: 'w-[18%]', align: 'left', render: (row: EventCheckInDTO) => row.sessionName ?? '—' },
          { id: 'lotSeat', header: 'Lote/Assento', width: 'w-[20%]', align: 'left', render: (row: EventCheckInDTO) => [row.lotName, row.seatLabel].filter(Boolean).join(' · ') || '—' },
          { id: 'date', header: 'Check-in', width: 'w-[18%]', align: 'left', render: (row: EventCheckInDTO) => formatDateTime(row.usedAt) },
          { id: 'operator', header: 'Operador', width: 'w-[18%]', align: 'left', render: (row: EventCheckInDTO) => row.operatorName ?? 'Não rastreado' },
        ]}
        data={checkIns}
        rowKey={(row) => row.id}
        loading={loading}
        emptyMessage={<EventEmptyState title="Nenhum check-in concluído." description="Os ingressos aparecerão aqui após a confirmação da entrada." />}
      />
      {total > 0 ? <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6"><Pagination total={total} page={page} pageSize={pageSize} onChange={onPageChange} hideIfSinglePage={false} /></div> : null}
    </EventTablePanel>
  );
}
