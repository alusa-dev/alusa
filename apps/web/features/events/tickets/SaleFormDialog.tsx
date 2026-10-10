'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_PAYMENT_METHODS,
  EVENT_TICKET_SALE_STATUS_LABELS,
  type EventTicketSaleStatus,
} from '@alusa/shared';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { MapPin } from '@/components/icons/icons';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';
import { cn } from '@/lib/utils';

import {
  createTicketSale,
  formatCurrency,
  releaseStaffSeatReservation,
  type EventScopedResources,
  type SchoolEventDTO,
  type StaffSeatReservationResult,
  type TicketLotDTO,
} from '../events-service';
import { EventDateTimeField as DateTimeField } from '../shared/EventDateTimeField';
import { EventField as Field } from '../shared/EventField';
import { EventNativeSelect as NativeSelect } from '../shared/EventNativeSelect';
import { eventQueryKeys } from '../shared/event-query-keys';
import { datetimeValue, getRoundedNowISOString, handleFormDataSubmit, LABEL_CLASS, nullableString, numberValue } from '../shared/event-form-utils';
import { mergeScopedPersonOptions } from '../shared/event-scoped-resource-options';
import { PublicOrderReservationCountdown } from '../map/public/PublicOrderReservationCountdown';
import { StaffSeatPickerDialog } from './StaffSeatPickerDialog';

type SeatSelectionState = StaffSeatReservationResult | null;

export function SaleFormDialog({
  eventId,
  event,
  lots,
  scopedResources,
  publishedMaps,
  trigger,
}: {
  eventId: string;
  event: SchoolEventDTO;
  lots: TicketLotDTO[];
  scopedResources?: EventScopedResources;
  publishedMaps: Array<{ id: string; name: string; startsAt: string }>;
  trigger: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discardAlertOpen, setDiscardAlertOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [seatSelection, setSeatSelection] = useState<SeatSelectionState>(null);
  const [selectedMapId, setSelectedMapId] = useState(() => (publishedMaps.length === 1 ? publishedMaps[0]!.id : ''));

  const ticketMode = event.ticketMode ?? (event.hasTickets ? 'SIMPLE' : 'NONE');
  const isSeatedSale = ticketMode === 'NUMBERED_SEATS';

  useEffect(() => {
    if (publishedMaps.length === 1 && !selectedMapId) setSelectedMapId(publishedMaps[0]!.id);
    if (selectedMapId && !publishedMaps.some((map) => map.id === selectedMapId)) {
      setSelectedMapId(publishedMaps.length === 1 ? publishedMaps[0]!.id : '');
      setSeatSelection(null);
    }
  }, [publishedMaps, selectedMapId]);

  const mutation = useMutation({
    mutationFn: createTicketSale,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Venda registrada', description: 'A venda de ingressos foi registrada com sucesso.' });
      setSeatSelection(null);
      setPickerOpen(false);
      setFormKey((key) => key + 1);
      setOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro na venda', description: (error as Error).message }),
  });

  const seatChips = useMemo(
    () =>
      (seatSelection?.seats ?? []).map((seat) => ({
        id: seat.id,
        label: seat.displayLabel,
      })),
    [seatSelection?.seats],
  );

  function submit(formData: FormData) {
    if (isSeatedSale) {
      if (!selectedMapId) {
        toast.error({ title: 'Selecione a sessão', description: 'Escolha o mapa da sessão antes de selecionar os assentos.' });
        return;
      }
      if (!seatSelection?.holdToken) {
        toast.error({ title: 'Assentos obrigatórios', description: 'Escolha os assentos no mapa antes de registrar a venda.' });
        return;
      }
      mutation.mutate({
        eventId,
        holdToken: seatSelection.holdToken,
        buyerName: nullableString(formData, 'buyerName'),
        buyerEmail: nullableString(formData, 'buyerEmail'),
        alunoId: nullableString(formData, 'alunoId'),
        responsavelId: nullableString(formData, 'responsavelId'),
        paymentMethod: nullableString(formData, 'paymentMethod'),
        status: nullableString(formData, 'status'),
        soldAt: datetimeValue(formData, 'soldAt'),
        notes: nullableString(formData, 'notes'),
      });
      return;
    }

    mutation.mutate({
      eventId,
      lotId: nullableString(formData, 'lotId'),
      buyerName: nullableString(formData, 'buyerName'),
      buyerEmail: nullableString(formData, 'buyerEmail'),
      alunoId: nullableString(formData, 'alunoId'),
      responsavelId: nullableString(formData, 'responsavelId'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      paymentMethod: nullableString(formData, 'paymentMethod'),
      status: nullableString(formData, 'status'),
      soldAt: datetimeValue(formData, 'soldAt'),
      notes: nullableString(formData, 'notes'),
    });
  }

  async function clearSeatSelection() {
    if (seatSelection?.holdToken) {
      try {
        await releaseStaffSeatReservation(eventId, seatSelection.holdToken);
      } catch {
        // best effort
      }
    }
    setSeatSelection(null);
  }

  async function removeSeatChip(seatId: string) {
    if (!seatSelection || !selectedMapId) return;
    const nextSeatIds = seatSelection.seats.filter((seat) => seat.id !== seatId).map((seat) => seat.id);
    if (nextSeatIds.length === 0) {
      await clearSeatSelection();
      return;
    }
    try {
      const { reserveStaffSeats } = await import('../events-service');
      const updated = await reserveStaffSeats(eventId, selectedMapId, {
        seatIds: nextSeatIds,
        holdToken: seatSelection.holdToken,
      });
      setSeatSelection(updated);
    } catch (error) {
      toast.error({ title: 'Não foi possível atualizar assentos', description: (error as Error).message });
    }
  }

  function hasEstablishedConfiguration() {
    if (seatSelection?.holdToken) return true;

    const form = formRef.current;
    if (!form) return false;

    const formData = new FormData(form);
    if (nullableString(formData, 'buyerName')?.trim()) return true;
    if (nullableString(formData, 'buyerEmail')?.trim()) return true;
    if (nullableString(formData, 'notes')?.trim()) return true;
    if (nullableString(formData, 'alunoId')) return true;
    if (nullableString(formData, 'responsavelId')) return true;
    if (!isSeatedSale && nullableString(formData, 'lotId')) return true;
    if (!isSeatedSale && (numberValue(formData, 'quantity') ?? 1) !== 1) return true;
    if (nullableString(formData, 'paymentMethod') !== 'MANUAL_PIX') return true;
    if (nullableString(formData, 'status') !== 'PENDING') return true;

    return false;
  }

  async function closeDialogAndRelease() {
    const holdToken = seatSelection?.holdToken;
    setSeatSelection(null);
    setPickerOpen(false);
    setDiscardAlertOpen(false);
    setFormKey((key) => key + 1);
    setOpen(false);
    if (holdToken) {
      try {
        await releaseStaffSeatReservation(eventId, holdToken);
      } catch {
        // best effort
      }
    }
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    if (hasEstablishedConfiguration()) {
      setDiscardAlertOpen(true);
      return;
    }
    void closeDialogAndRelease();
  }

  const hasSeatReservation = Boolean(seatSelection?.holdToken);

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          fullScreenMobile
          closeDisabled={mutation.isPending}
          className="flex min-h-0 max-h-[calc(100dvh-3rem)] max-w-[720px] flex-col gap-0 overflow-hidden rounded-[20px] p-0 sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0"
        >
          <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pb-5 pt-6 text-left max-md:px-5 max-md:pb-4 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
            <DialogTitle className="text-xl font-normal tracking-tight text-slate-950">Registrar venda manual</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-slate-600">
              {isSeatedSale
                ? 'Selecione os assentos no mapa publicado. A reserva temporária evita conflito com outras vendas.'
                : 'A venda valida estoque no backend. Alunos e responsáveis listados são os vinculados a participantes deste evento.'}
            </DialogDescription>
          </DialogHeader>
          <form key={formKey} ref={formRef} onSubmit={(event) => handleFormDataSubmit(event, submit)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 max-md:px-5">
              {isSeatedSale ? (
                <section aria-labelledby="manual-sale-seats-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                  <h3 id="manual-sale-seats-title" className="text-sm font-semibold text-slate-800">Sessão e assentos</h3>
                  <Field label="Sessão / mapa">
                    <NativeSelect
                      name="eventMapId"
                      value={selectedMapId}
                      required
                      placeholder="Selecione a sessão"
                      triggerClassName={wizardFieldInputClass}
                      options={publishedMaps.map((map) => ({
                        value: map.id,
                        label: `${map.name} · ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(map.startsAt))}`,
                      }))}
                      onValueChange={async (nextMapId) => {
                        if (nextMapId === selectedMapId) return;
                        const holdToken = seatSelection?.holdToken;
                        setSelectedMapId(nextMapId);
                        setSeatSelection(null);
                        setPickerOpen(false);
                        if (holdToken) {
                          try {
                            await releaseStaffSeatReservation(eventId, holdToken);
                          } catch {
                            toast.error({ title: 'A reserva anterior poderá ser liberada ao expirar.' });
                          }
                        }
                      }}
                    />
                  </Field>
                  <div className="grid gap-1.5">
                    <span className={LABEL_CLASS}>Assentos</span>
                    <div
                      role="group"
                      aria-label="Assentos selecionados"
                      className={cn(wizardFieldInputClass, 'flex h-auto min-h-10 items-stretch overflow-hidden p-0')}
                    >
                      <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 py-1.5">
                        {seatChips.map((chip) => (
                          <span
                            key={chip.id}
                            className="inline-flex select-none items-center gap-1 rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700"
                          >
                            {chip.label}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void removeSeatChip(chip.id);
                              }}
                              className="rounded-full p-0.5 transition-colors hover:bg-violet-200"
                              aria-label={`Remover assento ${chip.label}`}
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                        {seatChips.length === 0 ? (
                          <span className="text-sm text-slate-500">Nenhum assento selecionado</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={!selectedMapId}
                        onClick={() => setPickerOpen(true)}
                        className="inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-r-[10px] border-l border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MapPin className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">{seatChips.length > 0 ? 'Escolher mais' : 'Escolher assentos'}</span>
                      </button>
                    </div>
                    {!selectedMapId ? (
                      <p className="text-sm text-amber-800">
                        {publishedMaps.length === 0
                          ? 'Publique um mapa antes de vender assentos na secretaria.'
                          : 'Selecione a sessão para escolher os assentos.'}
                      </p>
                    ) : null}
                    {seatSelection ? (
                      <p className="text-sm font-medium text-slate-900">
                        Total: {formatCurrency(seatSelection.totalAmount)} ({seatChips.length} assento
                        {seatChips.length === 1 ? '' : 's'})
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="manual-sale-fields-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <h3 id="manual-sale-fields-title" className="text-sm font-semibold text-slate-800">Dados da venda</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {!isSeatedSale ? (
                    <Field label="Lote">
                      <NativeSelect
                        name="lotId"
                        required
                        placeholder="Selecione"
                        triggerClassName={wizardFieldInputClass}
                        options={lots
                          .filter((lot) => lot.status === 'ACTIVE')
                          .map((lot) => ({
                            value: lot.id,
                            label: `${lot.name} · ${formatCurrency(lot.unitPrice)} · ${lot.quantityAvailable} disp.`,
                          }))}
                      />
                    </Field>
                  ) : null}
                  <Field label="Comprador">
                    <Input name="buyerName" required className={wizardFieldInputClass} />
                  </Field>
                  <Field label="E-mail para receber os ingressos">
                    <Input name="buyerEmail" type="email" className={wizardFieldInputClass} />
                  </Field>
                  <Field label="Aluno vinculado">
                    <NativeSelect name="alunoId" placeholder="Opcional" triggerClassName={wizardFieldInputClass} options={mergeScopedPersonOptions(scopedResources?.alunos ?? [])} />
                  </Field>
                  <Field label="Responsável vinculado">
                    <NativeSelect name="responsavelId" placeholder="Opcional" triggerClassName={wizardFieldInputClass} options={mergeScopedPersonOptions(scopedResources?.responsaveis ?? [])} />
                  </Field>
                  {!isSeatedSale ? (
                    <Field label="Quantidade">
                      <Input name="quantity" type="number" min={1} defaultValue={1} required className={wizardFieldInputClass} />
                    </Field>
                  ) : null}
                  <Field label="Forma de pagamento">
                    <NativeSelect
                      name="paymentMethod"
                      defaultValue="MANUAL_PIX"
                      triggerClassName={wizardFieldInputClass}
                      options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                    />
                  </Field>
                  <Field label="Status">
                    <NativeSelect
                      name="status"
                      defaultValue="PENDING"
                      triggerClassName={wizardFieldInputClass}
                      options={(['PENDING', 'PAID', 'COMPLIMENTARY'] as EventTicketSaleStatus[]).map((status) => ({
                        value: status,
                        label: EVENT_TICKET_SALE_STATUS_LABELS[status],
                      }))}
                    />
                  </Field>
                  <Field label="Data da venda">
                    <DateTimeField name="soldAt" defaultValue={getRoundedNowISOString()} inputClassName={wizardFieldInputClass} timeSelectClassName={wizardFieldInputClass} />
                  </Field>
                </div>
                <Field label="Observações">
                  <Textarea name="notes" className={wizardTextareaFieldClass} />
                </Field>
              </section>
            </div>
            <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 bg-white px-6 py-4 max-md:px-5 max-md:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
              {isSeatedSale && seatSelection?.expiresAt ? (
                <PublicOrderReservationCountdown expiresAt={seatSelection.expiresAt} className="self-start text-xs sm:mr-auto sm:self-center" />
              ) : null}
              <Button type="button" variant="wizardSecondary" onClick={() => handleDialogOpenChange(false)} disabled={mutation.isPending} className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="wizardPrimary"
                disabled={mutation.isPending || (isSeatedSale && (!selectedMapId || !seatSelection?.holdToken))}
                className="h-10 min-h-10 w-[180px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full"
              >
                {mutation.isPending ? <><span>Registrando</span><LoadingDots label="Registrando venda" size="sm" className="text-white" /></> : 'Registrar venda'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardAlertOpen} onOpenChange={setDiscardAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar venda manual?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasSeatReservation
                ? 'Ao fechar, a reserva dos assentos será liberada e as informações preenchidas serão perdidas.'
                : 'As informações preenchidas serão perdidas.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void closeDialogAndRelease()}
            >
              Fechar e descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedMapId ? (
        <StaffSeatPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          eventId={eventId}
          mapId={selectedMapId}
          initialHoldToken={seatSelection?.holdToken}
          initialSeatIds={seatSelection?.seats.map((seat) => seat.id)}
          onConfirm={setSeatSelection}
        />
      ) : null}
    </>
  );
}
