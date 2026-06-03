'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import DataTable from '@/components/layout/DataTable';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

import { formatCurrency, unregisterEventParticipant, type EventParticipantDTO, type SchoolEventDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { eventQueryKeys } from '../shared/event-query-keys';
import { ParticipantActions } from './ParticipantActions';
import { ParticipantPaymentMethod, ParticipantPaymentStatusBadge } from './ParticipantPaymentBadge';
import { RegisterParticipantDialog } from './RegisterParticipantDialog';

export function EventParticipantsPanel({
  eventId,
  event,
  participants,
  loading,
}: {
  eventId: string;
  event: SchoolEventDTO;
  participants: EventParticipantDTO[];
  loading: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [participantToDelete, setParticipantToDelete] = useState<{ id: string; name: string } | null>(null);

  const unregisterMutation = useMutation({
    mutationFn: (participantId: string) => unregisterEventParticipant(eventId, participantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
      toast.success({ title: 'Inscrição removida', description: 'A inscrição do participante foi removida do evento.' });
      setParticipantToDelete(null);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao remover inscrição', description: error.message });
      setParticipantToDelete(null);
    },
  });

  return (
    <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader className="p-0 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold text-slate-800">Participantes Inscritos</CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Alunos vinculados ao evento, controle de pagamento da taxa e total investido pelo aluno.
          </p>
        </div>
        <RegisterParticipantDialog eventId={eventId} event={event} open={isRegisterOpen} onOpenChange={setIsRegisterOpen} />
      </CardHeader>
      <CardContent className="p-0">
        <TablePanel>
          <DataTable
            paginate={true}
            pageSize={5}
            columns={[
              {
                id: 'student',
                header: 'Aluno',
                width: 'w-[20%]',
                align: 'left',
                render: (part: EventParticipantDTO) => (
                  <div className="flex items-center gap-2 lg:gap-3 min-w-0">
                    <PersonAvatar name={part.displayName} src={part.aluno?.foto} size="sm" className="h-8 w-8 shrink-0" />
                    <span className="font-semibold text-slate-900 truncate">{part.displayName}</span>
                  </div>
                ),
              },
              {
                id: 'fee',
                header: 'Taxa Inscrição',
                width: 'w-[15%]',
                align: 'left',
                render: (part: EventParticipantDTO) => part.registrationFeeCharged === 0
                  ? <span className="text-slate-500 font-medium">Grátis</span>
                  : <span className="text-slate-900 font-medium">{formatCurrency(part.registrationFeeCharged)}</span>,
              },
              {
                id: 'percentPaid',
                header: 'Valor pago',
                width: 'w-[15%]',
                align: 'left',
                render: (part: EventParticipantDTO) => {
                  const pct = part.percentPaid !== undefined ? part.percentPaid : ((part.registrationFeeCharged === 0 || part.isFeePaid) ? 100 : 0);
                  return (
                    <div className="flex w-full max-w-[150px] flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-900">{pct}%</span>
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#A94DFF] rounded-full transition-all duration-300" style={{ width: pct + '%' }} />
                      </div>
                    </div>
                  );
                },
              },
              { id: 'paymentMethod', header: 'Forma Pagamento', width: 'w-[20%]', align: 'left', render: (part: EventParticipantDTO) => <ParticipantPaymentMethod participant={part} /> },
              { id: 'status', header: 'Status', width: 'w-[15%]', align: 'left', render: (part: EventParticipantDTO) => <ParticipantPaymentStatusBadge participant={part} /> },
              {
                id: 'actions',
                header: 'Ações',
                width: 'w-[15%]',
                align: 'right',
                render: (part: EventParticipantDTO) => (
                  <ParticipantActions
                    onView={() => router.push('/events/' + eventId + '/participants/' + part.id)}
                    onRemove={() => setParticipantToDelete({ id: part.id, name: part.displayName })}
                  />
                ),
              },
            ]}
            data={participants}
            rowKey={(part) => part.id}
            loading={loading}
            onRowClick={(part) => router.push('/events/' + eventId + '/participants/' + part.id)}
            emptyMessage={<EmptyState title="Nenhum aluno inscrito." description="Inscreva manualmente os alunos participantes do evento." />}
          />
        </TablePanel>
      </CardContent>

      <ConfirmDialog
        open={participantToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToDelete(null);
        }}
        title="Remover inscrição"
        description={'Tem certeza que deseja remover a inscrição de ' + participantToDelete?.name + '?'}
        confirmText="Remover"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (participantToDelete) unregisterMutation.mutate(participantToDelete.id);
        }}
        loading={unregisterMutation.isPending}
      />
    </Card>
  );
}
