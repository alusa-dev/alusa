'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { DangerActionDialog } from '@/components/rematriculas/DangerActionDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';

import {
  formatCurrency,
  permanentlyDeleteEventParticipant,
  unregisterEventParticipant,
  type EventParticipantDTO,
  type SchoolEventDTO,
} from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventPaginatedDataTable } from '../shared/EventPaginatedDataTable';
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
  const [participantToCancel, setParticipantToCancel] = useState<{ id: string; name: string } | null>(null);
  const [participantToPermanentlyDelete, setParticipantToPermanentlyDelete] = useState<{ id: string; name: string } | null>(null);

  const invalidateParticipants = () => {
    queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
    queryClient.invalidateQueries({ queryKey: eventQueryKeys.scopedResources(eventId) });
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

  const permanentDeleteMutation = useMutation({
    mutationFn: ({ participantId, confirmation, motivo }: { participantId: string; confirmation: string; motivo: string }) =>
      permanentlyDeleteEventParticipant(eventId, participantId, { confirmation, motivo }),
    onSuccess: () => {
      invalidateParticipants();
      toast.success({ title: 'Inscrição excluída', description: 'A inscrição foi removida definitivamente.' });
      setParticipantToPermanentlyDelete(null);
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
        <EventPaginatedDataTable
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
                    canPermanentlyDelete={part.canPermanentlyDelete === true}
                    onView={() => router.push('/events/' + eventId + '/participants/' + part.id)}
                    onCancel={() => setParticipantToCancel({ id: part.id, name: part.displayName })}
                    onPermanentDelete={() => setParticipantToPermanentlyDelete({ id: part.id, name: part.displayName })}
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
      </CardContent>

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

      <DangerActionDialog
        open={participantToPermanentlyDelete !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToPermanentlyDelete(null);
        }}
        title="Excluir inscrição definitivamente"
        description={`A inscrição de ${participantToPermanentlyDelete?.name ?? 'este aluno'} será excluída permanentemente. Contratos, documentos, evidências e decisões de consentimento vinculados serão removidos. Registros financeiros e operacionais do evento serão preservados para manter a integridade do histórico.`}
        confirmLabel="Excluir definitivamente"
        cancelLabel="Cancelar"
        loadingLabel="Excluindo..."
        confirmationText="EXCLUIR"
        confirmationLabel="Digite o texto abaixo para confirmar"
        motivoLabel="Motivo da exclusão"
        motivoPlaceholder="Informe por que esta inscrição deve ser excluída definitivamente."
        onConfirm={async (motivo) => {
          if (!participantToPermanentlyDelete) return;
          await permanentDeleteMutation.mutateAsync({
            participantId: participantToPermanentlyDelete.id,
            confirmation: 'EXCLUIR',
            motivo,
          });
        }}
      />
    </Card>
  );
}
