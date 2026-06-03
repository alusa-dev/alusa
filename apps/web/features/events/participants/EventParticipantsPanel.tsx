'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import DataTable from '@/components/layout/DataTable';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

import {
  formatCurrency,
  removeEventParticipant,
  unregisterEventParticipant,
  type EventParticipantDTO,
  type SchoolEventDTO,
} from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { eventQueryKeys } from '../shared/event-query-keys';
import { ParticipantActions } from './ParticipantActions';
import { ParticipantPaymentMethod, ParticipantPaymentStatusBadge } from './ParticipantPaymentBadge';
import { ReactivateParticipantDialog } from './ReactivateParticipantDialog';
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
  const [participantToCancel, setParticipantToCancel] = useState<{ id: string; name: string } | null>(null);
  const [participantToRemove, setParticipantToRemove] = useState<{ id: string; name: string } | null>(null);
  const [participantToReactivate, setParticipantToReactivate] = useState<EventParticipantDTO | null>(null);

  const invalidateParticipants = () => {
    queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
  };

  const unregisterMutation = useMutation({
    mutationFn: (participantId: string) => unregisterEventParticipant(eventId, participantId),
    onSuccess: () => {
      invalidateParticipants();
      toast.success({ title: 'Inscrição cancelada', description: 'A inscrição do participante foi cancelada e o histórico foi preservado.' });
      setParticipantToCancel(null);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao cancelar inscrição', description: error.message });
      setParticipantToCancel(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (participantId: string) => removeEventParticipant(eventId, participantId),
    onSuccess: () => {
      invalidateParticipants();
      toast.success({ title: 'Aluno removido do evento', description: 'A inscrição cancelada sem histórico foi removida.' });
      setParticipantToRemove(null);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao remover aluno do evento', description: error.message });
      setParticipantToRemove(null);
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
                    isCancelled={Boolean(part.cancelledAt)}
                    canRemove={part.canRemove === true}
                    canReactivate={part.canReactivate === true}
                    removeReasons={part.removalBlockReasons ?? []}
                    onView={() => router.push('/events/' + eventId + '/participants/' + part.id)}
                    onCancel={() => setParticipantToCancel({ id: part.id, name: part.displayName })}
                    onReactivate={() => setParticipantToReactivate(part)}
                    onRemove={() => setParticipantToRemove({ id: part.id, name: part.displayName })}
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

      <ReactivateParticipantDialog
        eventId={eventId}
        event={event}
        participant={participantToReactivate}
        open={participantToReactivate !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToReactivate(null);
        }}
      />

      <ConfirmDialog
        open={participantToCancel !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToCancel(null);
        }}
        title="Cancelar inscrição"
        description={'Tem certeza que deseja cancelar a inscrição de ' + participantToCancel?.name + '? O histórico financeiro e operacional será preservado.'}
        confirmText="Cancelar inscrição"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (participantToCancel) unregisterMutation.mutate(participantToCancel.id);
        }}
        loading={unregisterMutation.isPending}
      />

      <ConfirmDialog
        open={participantToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToRemove(null);
        }}
        title="Remover aluno do evento"
        description={'Tem certeza que deseja remover ' + participantToRemove?.name + ' do evento? Esta ação só é permitida para inscrição cancelada sem histórico operacional relevante.'}
        confirmText="Remover aluno do evento"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (participantToRemove) removeMutation.mutate(participantToRemove.id);
        }}
        loading={removeMutation.isPending}
      />
    </Card>
  );
}
