'use client';

import { EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS } from '@alusa/shared';

import DataTable from '@/components/layout/DataTable';

import { type CostumeAssignmentDTO, type CostumeDTO, type EventResources } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSoftBadge as SoftBadge, type EventSoftBadgeTone } from '../shared/EventSoftBadge';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { AssignmentActions } from './AssignmentActions';
import { COSTUME_BILLING_LABELS, getCostumeAssignmentFinancialBadge, getCostumeAssignmentValueLabel } from './costume-billing-ui';

const ASSIGNMENT_STATUS_TONES: Record<CostumeAssignmentDTO['status'], EventSoftBadgeTone> = {
  PENDING: 'warning',
  ORDERED: 'info',
  RECEIVED: 'info',
  DELIVERED: 'success',
  RETURNED: 'neutral',
  DAMAGED: 'danger',
  LOST: 'danger',
  CANCELLED: 'danger',
};

export function CostumeAssignmentsTable({
  assignments,
  costumes,
  eventId,
  resources,
  loading,
}: {
  assignments: CostumeAssignmentDTO[];
  costumes: CostumeDTO[];
  eventId: string;
  resources?: EventResources;
  loading: boolean;
}) {
  return (
    <TablePanel>
      <DataTable
        paginate={true}
        pageSize={5}
        columns={[
          { id: 'costume', header: 'Figurino', width: 'w-[18%]', align: 'left', render: (item: CostumeAssignmentDTO) => <span className="font-medium text-slate-950">{item.costume.name}</span> },
          { id: 'student', header: 'Aluno/Turma', width: 'w-[18%]', align: 'left', render: (item: CostumeAssignmentDTO) => item.aluno?.nome || item.turma?.nome || '-' },
          { id: 'status', header: 'Status', width: 'w-[13%]', align: 'center', render: (item: CostumeAssignmentDTO) => <SoftBadge tone={ASSIGNMENT_STATUS_TONES[item.status]}>{EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS[item.status]}</SoftBadge> },
          { id: 'billing', header: 'Cobrança', width: 'w-[17%]', align: 'left', render: (item: CostumeAssignmentDTO) => COSTUME_BILLING_LABELS[item.billingMode] },
          { id: 'value', header: 'Valor', width: 'w-[14%]', align: 'right', render: (item: CostumeAssignmentDTO) => getCostumeAssignmentValueLabel(item) },
          { id: 'finance', header: 'Financeiro', width: 'w-[12%]', align: 'center', render: (item: CostumeAssignmentDTO) => getCostumeAssignmentFinancialBadge(item) },
          { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (item: CostumeAssignmentDTO) => <AssignmentActions assignment={item} eventId={eventId} costumes={costumes} resources={resources} /> },
        ]}
        data={assignments}
        rowKey={(item) => item.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhuma entrega registrada." description="Vincule figurinos a alunos ou turmas para acompanhar entrega e devolução." />}
      />
    </TablePanel>
  );
}
