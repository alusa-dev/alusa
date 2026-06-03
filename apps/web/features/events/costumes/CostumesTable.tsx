'use client';

import { EVENT_COSTUME_CATEGORY_LABELS } from '@alusa/shared';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, type CostumeAssignmentDTO, type CostumeDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { CostumeActions } from './CostumeActions';

function getCostumeStats(costumeId: string, assignments: CostumeAssignmentDTO[]) {
  const costumeAssignments = assignments.filter((assignment) => assignment.costume.id === costumeId && assignment.status !== 'CANCELLED');
  const deliveredCount = costumeAssignments.filter((assignment) => assignment.status === 'DELIVERED').length;
  return {
    delivered: deliveredCount,
    activeCount: costumeAssignments.length,
  };
}

export function CostumesTable({
  costumes,
  assignments,
  eventId,
  loading,
}: {
  costumes: CostumeDTO[];
  assignments: CostumeAssignmentDTO[];
  eventId: string;
  loading: boolean;
}) {
  return (
    <TablePanel>
      <DataTable
        paginate={true}
        pageSize={5}
        columns={[
          { id: 'name', header: 'Figurino', width: 'w-[24%]', align: 'left', render: (item: CostumeDTO) => <span className="font-medium text-slate-950">{item.name}</span> },
          { id: 'category', header: 'Categoria', width: 'w-[14%]', align: 'left', render: (item: CostumeDTO) => EVENT_COSTUME_CATEGORY_LABELS[item.category] },
          { id: 'size', header: 'Tamanho', width: 'w-[8%]', align: 'left', render: (item: CostumeDTO) => item.size || '-' },
          { id: 'cost', header: 'Custo', width: 'w-[15%]', align: 'right', render: (item: CostumeDTO) => formatCurrency((item.schoolCost ?? 0) * item.quantity) },
          { id: 'charge', header: 'Valor cobrado', width: 'w-[15%]', align: 'right', render: (item: CostumeDTO) => formatCurrency(item.chargedValue ?? 0) },
          {
            id: 'qty',
            header: 'Estoque / Disp.',
            width: 'w-[14%]',
            align: 'right',
            render: (item: CostumeDTO) => {
              const stats = getCostumeStats(item.id, assignments);
              const available = item.quantity - stats.activeCount;
              const inStock = item.quantity - stats.delivered;
              return <span className="font-semibold text-slate-900">{inStock}/{available}</span>;
            },
          },
          { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (item: CostumeDTO) => <CostumeActions costume={item} eventId={eventId} /> },
        ]}
        data={costumes}
        rowKey={(item) => item.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhum figurino cadastrado." description="Cadastre figurinos e acompanhe tamanhos, entregas, devoluções e custos." />}
      />
    </TablePanel>
  );
}
