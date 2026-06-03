'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, Clock, MapPin, PackageCheck, User } from 'lucide-react';
import { type SchoolEventStatus } from '@alusa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { EventFormDialog } from '../list/EventFormDialog';
import { formatCurrency, formatDate, formatTime, updateEventStatus, type SchoolEventDTO } from '../events-service';
import { EventStatusBadge as StatusBadge } from '../shared/EventStatusBadge';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';

export function EventHeader({ event }: { event: SchoolEventDTO }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (status: SchoolEventStatus) => updateEventStatus(event.id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(event.id) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.events }),
      ]);
      toast.success({ title: 'Status atualizado', description: 'O status do evento foi atualizado com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao alterar status', description: (error as Error).message }),
  });

  const nextActions: Array<{ status: SchoolEventStatus; label: string; icon: typeof CheckCircle2 }> = [
    ...(event.status === 'PLANNING' ? [{ status: 'ACTIVE' as const, label: 'Ativar', icon: CheckCircle2 }] : []),
    ...(event.status === 'ACTIVE' ? [{ status: 'FINISHED' as const, label: 'Finalizar Evento', icon: CheckCircle2 }] : []),
    ...(event.status === 'FINISHED' ? [
      { status: 'ACTIVE' as const, label: 'Reativar Evento', icon: CheckCircle2 },
      { status: 'ARCHIVED' as const, label: 'Arquivar', icon: PackageCheck }
    ] : []),
    ...(event.status === 'ARCHIVED' ? [{ status: 'FINISHED' as const, label: 'Desarquivar', icon: PackageCheck }] : []),
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-950 md:text-2xl">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{event.locationName || 'Local não definido'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{formatDate(event.startsAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{formatTime(event.startsAt)}</span>
            </div>
            {event.responsibleUser?.nome && (
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{event.responsibleUser.nome}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <EventFormDialog event={event} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}>Editar</Button>} />
          {nextActions.map((action) => {
            if (action.status === 'FINISHED') {
              return (
                <Dialog key={action.status}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className={OUTLINE_BUTTON_CLASS}>
                      <action.icon className="h-4 w-4" />
                      {action.label}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Finalizar Evento - Detalhes e Insights</DialogTitle>
                      <DialogDescription>
                        Confira o resumo financeiro e métricas operacionais obtidas no evento <strong>{event.name}</strong> antes de finalizá-lo.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Receita Recebida</span>
                          <strong className="block text-lg font-bold text-emerald-600 mt-1">
                            {formatCurrency(event.metrics.receitaRealizada)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Custos Pagos</span>
                          <strong className="block text-lg font-bold text-amber-600 mt-1">
                            {formatCurrency(event.metrics.custoRealizado || 0)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Resultado Líquido</span>
                          <strong className={cn(
                            "block text-lg font-bold mt-1",
                            event.metrics.resultadoRealizado >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {formatCurrency(event.metrics.resultadoRealizado)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Ingressos Vendidos</span>
                          <strong className="block text-lg font-bold text-slate-900 mt-1">
                            {event.metrics.ingressosVendidos}
                          </strong>
                        </div>
                      </div>
                      
                      {event.metrics.figurinosPendentes > 0 && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800 text-xs flex items-center gap-2">
                          <span className="font-semibold">Atenção:</span> Ainda constam {event.metrics.figurinosPendentes} figurinos pendentes de entrega/retorno.
                        </div>
                      )}
                    </div>

                    <DialogFooter className="flex sm:justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => window.print()}
                      >
                        Imprimir relatório
                      </Button>
                      <DialogClose asChild>
                        <Button
                          type="button"
                          className={PRIMARY_BUTTON_CLASS}
                          onClick={() => statusMutation.mutate('FINISHED')}
                          disabled={statusMutation.isPending}
                        >
                          {statusMutation.isPending ? 'Finalizando...' : 'Sair'}
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              );
            }

            return (
              <Button
                key={action.status}
                variant="outline"
                className={cn(
                  OUTLINE_BUTTON_CLASS,
                  action.status === 'CANCELLED' && 'text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700',
                )}
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(action.status)}
              >
                <action.icon className="h-4 w-4" />
                {action.label}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
