'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supportsEventCostPaymentOrigin } from '@alusa/domain/events';
import { Button } from '@/components/ui/button';
import { CheckCircle, Edit, ErrorCircle, Eye, MoreVertical, RotateCcw } from '@/components/icons/icons';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { wizardFieldInputClass } from '@/components/shared/wizard/field-styles';
import { DatePicker } from '@/components/ui/date-picker';
import { LoadingDots } from '@/components/ui/LoadingDots';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { deleteEventCost, formatCurrency, registerCostumeAssignmentPayment, registerEventCostPayment, refundCostumeAssignmentPayment, updateFinancialEntry, type FinancialEntryDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, formatDateInputValue, handleFormDataSubmit, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { FinancialEntryDetailsDialog } from './FinancialEntryDetailsDialog';
import { FinancialEntryEditDialog } from './FinancialEntryEditDialog';
import { getFinancialOriginActionLabel } from './financial-entry-ui';

function formatPaymentAmountInput(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(digits) / 100);
}

function getLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function FinanceActions({ entry, eventId }: { entry: FinancialEntryDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [fullRefundOpen, setFullRefundOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundText, setRefundText] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentText, setPaymentText] = useState('');
  const [paymentDate, setPaymentDate] = useState<Date | undefined>(() => getLocalToday());
  const paymentIdempotencyKey = useRef<string | null>(null);
  const refundIdempotencyKey = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateFinancialEntry(entry.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
      ]);
      setCancelOpen(false);
      setFullRefundOpen(false);
      setRefundOpen(false);
      setRefundText('');
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });
  const paymentMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => entry.originType === 'COSTUME_ASSIGNMENT'
      ? registerCostumeAssignmentPayment(entry.id, payload)
      : registerEventCostPayment(entry.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
      ]);
      toast.success({ title: entry.originType === 'COSTUME_ASSIGNMENT' ? 'Recebimento registrado' : 'Pagamento registrado', description: 'O saldo restante foi atualizado.' });
      setPaymentOpen(false);
      setPaymentText('');
      paymentIdempotencyKey.current = null;
    },
    onError: (error) => toast.error({ title: 'Erro no pagamento', description: (error as Error).message }),
  });
  const costumeRefundMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => refundCostumeAssignmentPayment(entry.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
      ]);
      setRefundOpen(false);
      setFullRefundOpen(false);
      setRefundText('');
      refundIdempotencyKey.current = null;
      toast.success({ title: 'Estorno registrado', description: 'O ledger e o saldo da cobrança foram atualizados.' });
    },
    onError: (error) => toast.error({ title: 'Erro no estorno', description: (error as Error).message }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteEventCost(entry.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      setDeleteOpen(false);
      toast.success({ title: 'Custo excluído', description: 'O lançamento foi removido permanentemente.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao excluir custo', description: (error as Error).message }),
  });
  const refundableAmount = Math.max((entry.actualAmount ?? entry.expectedAmount) - (entry.refundedAmount ?? 0), 0);
  const isManual = entry.originType === 'MANUAL';
  const isRegistrationRevenue = entry.originType === 'EVENT_REGISTRATION'
    || (entry.category.trim().toLocaleLowerCase('pt-BR') === 'taxa de inscrição'
      && entry.description.trim().toLocaleLowerCase('pt-BR').startsWith('taxa de inscrição'));
  const isRegistrationRevenueEntry = entry.type === 'REVENUE' && isRegistrationRevenue;
  const isPendingManual = isManual && (entry.status === 'EXPECTED' || entry.status === 'PENDING');
  const canHardDelete = entry.type === 'COST';
  const remainingCost = Math.max(entry.expectedAmount - (entry.netAmount ?? entry.actualAmount ?? 0), 0);
  const supportsCostPayment = supportsEventCostPaymentOrigin(entry.originType, entry.originId);
  const canRegisterCostPayment = entry.type === 'COST' && supportsCostPayment && remainingCost > 0 && !['CANCELLED', 'REFUNDED', 'PAID'].includes(entry.status);
  const isCostumeAssignmentRevenue = entry.type === 'REVENUE' && entry.originType === 'COSTUME_ASSIGNMENT';
  const canRegisterCostumePayment = isCostumeAssignmentRevenue && remainingCost > 0 && !['CANCELLED', 'REFUNDED', 'RECEIVED'].includes(entry.status);
  const canRefund = (isManual && ((entry.type === 'REVENUE' && entry.status === 'RECEIVED') || (entry.type === 'COST' && ['PAID', 'PARTIALLY_PAID'].includes(entry.status))))
    || (entry.type === 'COST' && supportsCostPayment && entry.payments?.some((payment) => payment.status === 'PAID') === true)
    || (isCostumeAssignmentRevenue && entry.payments?.some((payment) => payment.status === 'PAID') === true);
  const hasOtherActions = isManual
    || canRegisterCostPayment
    || canRegisterCostumePayment
    || (isPendingManual && entry.type === 'REVENUE')
    || canRefund
    || isPendingManual
    || canHardDelete;
  const showDetailsOnly = isRegistrationRevenueEntry || !hasOtherActions;
  const realizedLabel = 'Marcar como recebido';
  const refundedLabel = entry.type === 'COST' ? 'Estornar pagamento' : 'Estornar recebimento';

  function submitCostPayment(payload: Record<string, unknown>) {
    paymentIdempotencyKey.current ??= crypto.randomUUID();
    paymentMutation.mutate({ ...payload, idempotencyKey: paymentIdempotencyKey.current });
  }

  function submitCostumeRefund(amount?: number) {
    refundIdempotencyKey.current ??= crypto.randomUUID();
    costumeRefundMutation.mutate({ idempotencyKey: refundIdempotencyKey.current, ...(amount === undefined ? {} : { amount }) });
  }

  function openCostPaymentDialog() {
    setPaymentText(formatPaymentAmountInput(String(Math.round(remainingCost * 100))));
    setPaymentDate(getLocalToday());
    setPaymentOpen(true);
  }

  function submitPartialRefund(formData: FormData) {
    const refundedAmount = parseCurrencyInput(nullableString(formData, 'refundedAmount') ?? '');
    if (refundedAmount <= 0 || refundedAmount >= refundableAmount) {
      toast.error({ title: 'Valor inválido', description: 'Informe um valor maior que zero e menor que o recebido.' });
      return;
    }
    if (isCostumeAssignmentRevenue) {
      submitCostumeRefund(refundedAmount);
      return;
    }
    mutation.mutate({
      status: 'PARTIALLY_REFUNDED',
      actualAmount: refundableAmount,
      realizedAt: entry.realizedAt ?? new Date().toISOString(),
      refundedAmount,
    });
  }

  return (
    <>
      {showDetailsOnly ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900"
          aria-label="Ver detalhes da inscrição"
          title="Ver detalhes"
          onClick={() => setDetailsOpen(true)}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />
              Ver detalhes
            </DropdownMenuItem>

            {isManual ? (
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
            ) : entry.type === 'COST' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  {getFinancialOriginActionLabel(entry)}
                </DropdownMenuItem>
              </>
            ) : null}

            {canRegisterCostPayment || canRegisterCostumePayment || (isPendingManual && entry.type === 'REVENUE') || canRefund ? <DropdownMenuSeparator /> : null}

            {canRegisterCostPayment ? (
              <DropdownMenuItem onClick={openCostPaymentDialog}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Registrar pagamento
              </DropdownMenuItem>
            ) : null}
            {canRegisterCostumePayment ? (
              <DropdownMenuItem onClick={openCostPaymentDialog}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Registrar recebimento
              </DropdownMenuItem>
            ) : null}

            {isPendingManual && entry.type === 'REVENUE' ? (
              <DropdownMenuItem onClick={() => mutation.mutate({
                status: 'RECEIVED',
                actualAmount: entry.actualAmount ?? entry.expectedAmount,
                realizedAt: entry.realizedAt ?? new Date().toISOString(),
              })}>
                <CheckCircle className="mr-2 h-4 w-4" />
                {realizedLabel}
              </DropdownMenuItem>
            ) : null}

            {canRefund ? (
              <>
                {entry.type === 'REVENUE' ? (
                  <DropdownMenuItem onClick={() => setRefundOpen(true)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Estorno parcial
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => setFullRefundOpen(true)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {refundedLabel}
                </DropdownMenuItem>
              </>
            ) : null}

            {isPendingManual ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => setCancelOpen(true)}>
                  <ErrorCircle className="mr-2 h-4 w-4" />
                  Cancelar
                </DropdownMenuItem>
              </>
            ) : null}
            {canHardDelete ? <DropdownMenuSeparator /> : null}
            {canHardDelete ? (
              <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => setDeleteOpen(true)}>
                <ErrorCircle className="mr-2 h-4 w-4" />
                Excluir custo
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <FinancialEntryDetailsDialog entry={entry} open={detailsOpen} onOpenChange={setDetailsOpen} />

      <Dialog
        open={paymentOpen}
        onOpenChange={(open) => {
          if (!open && paymentMutation.isPending) return;
          setPaymentOpen(open);
          if (!open) {
            setPaymentText('');
            setPaymentDate(getLocalToday());
            paymentIdempotencyKey.current = null;
          }
        }}
      >
        <DialogContent
          fullScreenMobile
          closeDisabled={paymentMutation.isPending}
          className="flex max-w-[560px] flex-col gap-0 overflow-hidden rounded-[20px] p-0 sm:rounded-[20px] max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0"
        >
          <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pb-5 pt-6 text-left max-md:px-5 max-md:pb-4 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))]">
            <DialogTitle className="text-xl font-normal tracking-tight text-slate-950">Registrar pagamento</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-slate-600">
              {entry.originType === 'COSTUME_ASSIGNMENT' ? 'Registre um recebimento parcial ou quite o saldo desta cobrança.' : 'Registre um pagamento parcial ou quite o saldo deste custo.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => handleFormDataSubmit(event, (formData) => submitCostPayment({
              amount: parseCurrencyInput(nullableString(formData, 'amount') ?? ''),
              paymentMethod: nullableString(formData, 'paymentMethod') ?? 'OTHER',
              paidAt: nullableString(formData, 'paidAt') || undefined,
              notes: nullableString(formData, 'notes') || undefined,
            }))}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 max-md:px-5">
              <section aria-label={entry.originType === 'COSTUME_ASSIGNMENT' ? 'Saldo da cobrança' : 'Saldo do custo'} className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-600">Saldo restante</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{formatCurrency(remainingCost)}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">O valor sugerido quita o saldo. Você também pode informar um valor parcial.</p>
              </section>

              <section aria-labelledby="cost-payment-fields-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <h3 id="cost-payment-fields-title" className="text-sm font-semibold text-slate-800">Dados do pagamento</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={entry.originType === 'COSTUME_ASSIGNMENT' ? 'Valor recebido' : 'Valor pago'}>
                    <div className="relative">
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-slate-500">R$</span>
                      <Input name="amount" value={paymentText} onChange={(event) => setPaymentText(formatPaymentAmountInput(event.target.value))} className={cn(wizardFieldInputClass, 'pl-9 text-left tabular-nums')} required />
                    </div>
                  </Field>
                  <Field label="Forma de pagamento">
                    <Select name="paymentMethod" defaultValue="OTHER">
                      <SelectTrigger className={cn(wizardFieldInputClass, 'alusa-select-trigger')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="alusa-wizard-corner-smoothing">
                        <SelectItem value="CASH">Dinheiro</SelectItem>
                        <SelectItem value="MANUAL_PIX">Pix</SelectItem>
                        <SelectItem value="EXTERNAL_CARD">Cartão</SelectItem>
                        <SelectItem value="TRANSFER">Transferência</SelectItem>
                        <SelectItem value="OTHER">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Data do pagamento">
                    <input type="hidden" name="paidAt" value={formatDateInputValue(paymentDate)} />
                    <DatePicker value={paymentDate} onChange={setPaymentDate} variant="input" placeholder="dd/mm/aaaa" className={wizardFieldInputClass} readOnlyInput />
                  </Field>
                </div>
                <Field label="Observações">
                  <Input name="notes" className={wizardFieldInputClass} placeholder="Opcional" />
                </Field>
              </section>
            </div>

            <DialogFooter className="shrink-0 gap-2 border-t border-slate-100 bg-white px-6 py-4 max-md:px-5">
              <Button type="button" variant="wizardSecondary" onClick={() => setPaymentOpen(false)} disabled={paymentMutation.isPending} className="h-10 min-h-10 w-[120px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
                Cancelar
              </Button>
              <Button type="submit" variant="wizardPrimary" disabled={paymentMutation.isPending} className="h-10 min-h-10 w-[180px] min-w-0 rounded-[10px] px-5 font-normal max-md:w-full">
                {paymentMutation.isPending ? <><span>Registrando</span><LoadingDots label="Registrando pagamento" size="sm" className="text-white" /></> : entry.originType === 'COSTUME_ASSIGNMENT' ? 'Registrar recebimento' : 'Registrar pagamento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {canRefund ? (
        <ConfirmDialog
          open={fullRefundOpen}
          onOpenChange={setFullRefundOpen}
          title={`${refundedLabel}?`}
          description={isCostumeAssignmentRevenue
            ? 'Os recebimentos registrados serão estornados no ledger e o histórico será preservado.'
            : entry.type === 'COST'
            ? 'Os pagamentos registrados serão estornados e o custo será encerrado, incluindo o saldo que ainda faltava pagar.'
            : 'A receita manual será marcada como estornada e deixará de compor as receitas recebidas.'}
          confirmText={refundedLabel}
          cancelText="Cancelar"
          variant="destructive"
          onConfirm={() => isCostumeAssignmentRevenue
            ? submitCostumeRefund()
            : mutation.mutate({
              status: 'REFUNDED',
              actualAmount: refundableAmount,
              realizedAt: entry.realizedAt ?? new Date().toISOString(),
              refundedAmount: refundableAmount,
            })}
          loading={mutation.isPending || costumeRefundMutation.isPending}
        />
      ) : null}

      {canHardDelete ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Excluir custo permanentemente?"
          description="Esta exclusão permanente remove o custo e todo o histórico e parcelas locais de pagamento e estorno. A referência Asaas também será removida da Alusa; nenhuma ação será executada no Asaas."
          confirmText="Excluir custo"
          cancelText="Manter custo"
          variant="destructive"
          onConfirm={() => deleteMutation.mutate()}
          loading={deleteMutation.isPending}
        />
      ) : null}

      {isManual || isCostumeAssignmentRevenue ? (
        <>
          {isManual ? <FinancialEntryEditDialog entry={entry} eventId={eventId} open={editOpen} onOpenChange={setEditOpen} /> : null}

          <Dialog open={refundOpen} onOpenChange={(nextOpen) => { if (nextOpen || !(mutation.isPending || costumeRefundMutation.isPending)) setRefundOpen(nextOpen); }}>
            <DialogContent closeDisabled={mutation.isPending || costumeRefundMutation.isPending} className="max-w-md">
              <DialogHeader>
                <DialogTitle>Estorno parcial</DialogTitle>
                <DialogDescription>Informe o valor estornado para ajustar o recebido líquido.</DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => handleFormDataSubmit(event, submitPartialRefund)} className="grid gap-4">
                <Field label="Valor estornado">
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">R$</span>
                    <Input
                      name="refundedAmount"
                      value={refundText}
                      onChange={(event) => setRefundText(formatCurrencyInput(event.target.value))}
                      className={cn(FILTER_INPUT_CLASS, 'pl-10 text-right')}
                      required
                    />
                  </div>
                </Field>
                <DialogFooter>
                <Button type="submit" disabled={mutation.isPending || costumeRefundMutation.isPending}>{mutation.isPending || costumeRefundMutation.isPending ? <><span>Estornando</span><LoadingDots label="Registrando estorno" size="sm" className="text-white" /></> : 'Confirmar estorno'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title="Cancelar lançamento?"
            description="O lançamento manual será marcado como cancelado e deixará de compor os resultados do evento."
            confirmText="Cancelar lançamento"
            cancelText="Voltar"
            variant="destructive"
            onConfirm={() => mutation.mutate({ status: 'CANCELLED' })}
            loading={mutation.isPending}
          />

        </>
      ) : null}
    </>
  );
}
