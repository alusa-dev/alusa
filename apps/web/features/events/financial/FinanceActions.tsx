'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, MoreVertical, Pencil, RotateCcw, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { updateFinancialEntry, type FinancialEntryDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { eventQueryKeys } from '../shared/event-query-keys';
import { FILTER_INPUT_CLASS, nullableString } from '../shared/event-form-utils';
import { formatCurrencyInput, parseCurrencyInput } from '../shared/event-formatters';
import { FinancialEntryDetailsDialog } from './FinancialEntryDetailsDialog';
import { FinancialEntryEditDialog } from './FinancialEntryEditDialog';
import { getFinancialOriginActionLabel } from './financial-entry-ui';

export function FinanceActions({ entry, eventId }: { entry: FinancialEntryDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [fullRefundOpen, setFullRefundOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundText, setRefundText] = useState('');
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateFinancialEntry(entry.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      setCancelOpen(false);
      setFullRefundOpen(false);
      setRefundOpen(false);
      setRefundText('');
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });
  const refundableAmount = entry.actualAmount ?? entry.expectedAmount;
  const isManual = entry.originType === 'MANUAL';
  const isPendingManual = isManual && (entry.status === 'EXPECTED' || entry.status === 'PENDING');
  const canRefund = isManual && ((entry.type === 'REVENUE' && entry.status === 'RECEIVED') || (entry.type === 'COST' && entry.status === 'PAID'));
  const realizedLabel = entry.type === 'COST' ? 'Marcar como pago' : 'Marcar como recebido';
  const refundedLabel = entry.type === 'COST' ? 'Estornar pagamento' : 'Estornar recebimento';

  function submitPartialRefund(formData: FormData) {
    const refundedAmount = parseCurrencyInput(nullableString(formData, 'refundedAmount') ?? '');
    if (refundedAmount <= 0 || refundedAmount >= refundableAmount) {
      toast.error({ title: 'Valor inválido', description: 'Informe um valor maior que zero e menor que o recebido.' });
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
            <>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </DropdownMenuItem>
              {isPendingManual ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => mutation.mutate({
                      status: entry.type === 'COST' ? 'PAID' : 'RECEIVED',
                      actualAmount: entry.actualAmount ?? entry.expectedAmount,
                      realizedAt: entry.realizedAt ?? new Date().toISOString(),
                    })}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {realizedLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50" onClick={() => setCancelOpen(true)}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </DropdownMenuItem>
                </>
              ) : null}
              {canRefund ? (
                <>
                  <DropdownMenuSeparator />
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
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                {getFinancialOriginActionLabel(entry)}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <FinancialEntryDetailsDialog entry={entry} open={detailsOpen} onOpenChange={setDetailsOpen} />

      {isManual ? (
        <>
          <FinancialEntryEditDialog entry={entry} eventId={eventId} open={editOpen} onOpenChange={setEditOpen} />

          <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Estorno parcial</DialogTitle>
                <DialogDescription>Informe o valor estornado para ajustar o recebido líquido.</DialogDescription>
              </DialogHeader>
              <form action={submitPartialRefund} className="grid gap-4">
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
                  <Button type="submit" disabled={mutation.isPending}>Confirmar estorno</Button>
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

          <ConfirmDialog
            open={fullRefundOpen}
            onOpenChange={setFullRefundOpen}
            title={`${refundedLabel}?`}
            description={entry.type === 'COST'
              ? 'O custo manual será marcado como estornado e deixará de compor os custos pagos.'
              : 'A receita manual será marcada como estornada e deixará de compor as receitas recebidas.'}
            confirmText={refundedLabel}
            cancelText="Cancelar"
            variant="destructive"
            onConfirm={() => mutation.mutate({
              status: 'REFUNDED',
              actualAmount: refundableAmount,
              realizedAt: entry.realizedAt ?? new Date().toISOString(),
              refundedAmount: refundableAmount,
            })}
            loading={mutation.isPending}
          />
        </>
      ) : null}
    </>
  );
}
