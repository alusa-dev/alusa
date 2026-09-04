'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

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
import { datetimeValue, FILTER_INPUT_CLASS, getRoundedNowISOString, LABEL_CLASS, nullableString, numberValue } from '../shared/event-form-utils';
import { mergeScopedPersonOptions } from '../shared/event-scoped-resource-options';
import { PublicOrderReservationCountdown } from '../map/public/PublicOrderReservationCountdown';
import { StaffSeatPickerDialog } from './StaffSeatPickerDialog';

type SeatSelectionState = StaffSeatReservationResult | null;

export function SaleFormDialog({
  eventId,
  event,
  lots,
  scopedResources,
  publishedMapId,
  trigger,
}: {
  eventId: string;
  event: SchoolEventDTO;
  lots: TicketLotDTO[];
  scopedResources?: EventScopedResources;
  publishedMapId?: string | null;
  trigger: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discardAlertOpen, setDiscardAlertOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [seatSelection, setSeatSelection] = useState<SeatSelectionState>(null);

  const ticketMode = event.ticketMode ?? (event.hasTickets ? 'SIMPLE' : 'NONE');
  const isSeatedSale = ticketMode === 'NUMBERED_SEATS';

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
    if (!seatSelection || !publishedMapId) return;
    const nextSeatIds = seatSelection.seats.filter((seat) => seat.id !== seatId).map((seat) => seat.id);
    if (nextSeatIds.length === 0) {
      await clearSeatSelection();
      return;
    }
    try {
      const { reserveStaffSeats } = await import('../events-service');
      const updated = await reserveStaffSeats(eventId, publishedMapId, {
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar venda manual</DialogTitle>
            <DialogDescription>
              {isSeatedSale
                ? 'Selecione os assentos no mapa publicado. A reserva temporária evita conflito com outras vendas.'
                : 'A venda valida estoque no backend. Alunos e responsáveis listados são os vinculados a participantes deste evento.'}
            </DialogDescription>
          </DialogHeader>
          <form key={formKey} ref={formRef} action={submit} className="grid gap-4">
            {isSeatedSale ? (
              <div className="grid gap-1.5">
                <span className={LABEL_CLASS}>Assentos</span>
                <div
                  role="group"
                  aria-label="Assentos selecionados"
                  className="flex min-h-[40px] w-full items-stretch overflow-hidden rounded-md border border-gray-300 alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)]"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-2 py-1.5">
                    {seatChips.map((chip) => (
                      <span
                        key={chip.id}
                        className="inline-flex select-none items-center gap-1 rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 alusa-dark:bg-[color:rgba(169,77,255,0.18)] alusa-dark:text-[color:var(--color-text-brand)]"
                      >
                        {chip.label}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void removeSeatChip(chip.id);
                          }}
                          className="rounded-full p-0.5 transition-colors hover:bg-violet-200 alusa-dark:hover:bg-[color:rgba(169,77,255,0.24)]"
                          aria-label={`Remover assento ${chip.label}`}
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    {seatChips.length === 0 ? (
                      <span className="text-sm text-slate-500 alusa-dark:text-[color:var(--color-input-placeholder)]">
                        Nenhum assento selecionado
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={!publishedMapId}
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 self-stretch border-l border-gray-300 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 alusa-dark:border-[color:var(--color-input-border)] alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)]"
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{seatChips.length > 0 ? 'Escolher mais' : 'Escolher assentos'}</span>
                  </button>
                </div>
                {!publishedMapId ? (
                  <p className="text-sm text-amber-800">Publique o mapa do evento antes de vender assentos na secretaria.</p>
                ) : null}
                {seatSelection ? (
                  <p className="text-sm font-medium text-slate-900">
                    Total: {formatCurrency(seatSelection.totalAmount)} ({seatChips.length} assento
                    {seatChips.length === 1 ? '' : 's'})
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {!isSeatedSale ? (
                <Field label="Lote">
                  <NativeSelect
                    name="lotId"
                    required
                    placeholder="Selecione"
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
                <Input name="buyerName" required className={FILTER_INPUT_CLASS} />
              </Field>
              <Field label="E-mail para receber os ingressos">
                <Input name="buyerEmail" type="email" className={FILTER_INPUT_CLASS} />
              </Field>
              <Field label="Aluno vinculado">
                <NativeSelect name="alunoId" placeholder="Opcional" options={mergeScopedPersonOptions(scopedResources?.alunos ?? [])} />
              </Field>
              <Field label="Responsável vinculado">
                <NativeSelect name="responsavelId" placeholder="Opcional" options={mergeScopedPersonOptions(scopedResources?.responsaveis ?? [])} />
              </Field>
              {!isSeatedSale ? (
                <Field label="Quantidade">
                  <Input name="quantity" type="number" min={1} defaultValue={1} required className={FILTER_INPUT_CLASS} />
                </Field>
              ) : null}
              <Field label="Forma de pagamento">
                <NativeSelect
                  name="paymentMethod"
                  defaultValue="MANUAL_PIX"
                  options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                />
              </Field>
              <Field label="Status">
                <NativeSelect
                  name="status"
                  defaultValue="PENDING"
                  options={(['PENDING', 'PAID', 'COMPLIMENTARY'] as EventTicketSaleStatus[]).map((status) => ({
                    value: status,
                    label: EVENT_TICKET_SALE_STATUS_LABELS[status],
                  }))}
                />
              </Field>
              <Field label="Data da venda">
                <DateTimeField name="soldAt" defaultValue={getRoundedNowISOString()} />
              </Field>
            </div>
            <Field label="Observações">
              <Textarea name="notes" className="rounded-xl border-slate-200" />
            </Field>
            <DialogFooter
              className={
                isSeatedSale && seatSelection?.expiresAt
                  ? 'sm:items-center sm:justify-between'
                  : undefined
              }
            >
              {isSeatedSale && seatSelection?.expiresAt ? (
                <PublicOrderReservationCountdown expiresAt={seatSelection.expiresAt} className="self-start text-xs sm:self-center" />
              ) : null}
              <Button
                type="submit"
                disabled={mutation.isPending || (isSeatedSale && (!publishedMapId || !seatSelection?.holdToken))}
              >
                Registrar venda
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

      {publishedMapId ? (
        <StaffSeatPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          eventId={eventId}
          mapId={publishedMapId}
          initialHoldToken={seatSelection?.holdToken}
          initialSeatIds={seatSelection?.seats.map((seat) => seat.id)}
          onConfirm={setSeatSelection}
        />
      ) : null}
    </>
  );
}
