'use client';

import { EVENT_FINANCIAL_STATUS_LABELS, EVENT_PAYMENT_METHOD_LABELS } from '@alusa/shared';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { formatCurrency, formatDate, type FinancialEntryDTO } from '../events-service';
import { EventField as Field } from '../shared/EventField';
import { getFinancialOriginActionLabel, getFinancialOriginLabel } from './financial-entry-ui';

export function FinancialEntryDetailsDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: FinancialEntryDTO;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}) {
  const paidAmount = entry.netAmount ?? entry.actualAmount ?? 0;
  const remainingAmount = Math.max(entry.expectedAmount - paidAmount, 0);
  const details = [
    ['Tipo', entry.type === 'COST' ? 'Custo' : 'Receita'],
    ['Categoria', entry.category],
    ['Previsto', formatCurrency(entry.expectedAmount)],
    ...(entry.discountAmount && entry.discountAmount > 0
      ? [['Valor original', formatCurrency(entry.grossAmount ?? entry.expectedAmount)], ['Desconto', formatCurrency(entry.discountAmount)]]
      : []),
    ['Realizado', formatCurrency(entry.netAmount ?? entry.actualAmount ?? 0)],
    ['Estornado', entry.refundedAmount ? formatCurrency(entry.refundedAmount) : '-'],
    ['Status', EVENT_FINANCIAL_STATUS_LABELS[entry.status]],
    ['Origem', getFinancialOriginLabel(entry)],
    ['Vencimento', entry.dueDate ? formatDate(entry.dueDate) : '-'],
    ['Realização', entry.realizedAt ? formatDate(entry.realizedAt) : '-'],
    ['Método', entry.paymentMethod ? EVENT_PAYMENT_METHOD_LABELS[entry.paymentMethod] : '-'],
    ['Fornecedor', entry.supplier || '-'],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Detalhes do lançamento</DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-dashed divide-slate-200 border-y border-dashed border-slate-200">
          {details
            .filter(([label]) => !(entry.type === 'COST' && ['Realizado', 'Realização', 'Método'].includes(label)))
            .map(([label, value]) => (
              <div key={label} className="flex min-h-[44px] items-baseline justify-between gap-4 py-3 sm:gap-8">
                <dt className="min-w-0 text-sm leading-5 text-slate-600">{label}</dt>
                <dd className="shrink-0 text-right text-sm font-medium leading-5 tabular-nums text-slate-800">{value}</dd>
              </div>
            ))}
        </dl>
        {entry.originType !== 'MANUAL' ? (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            Este lançamento é automático. Para alterar valores ou status, use a origem indicada: {getFinancialOriginActionLabel(entry).toLowerCase()}.
          </div>
        ) : null}
        {entry.notes ? (
          <Field label="Observações">
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{entry.notes}</div>
          </Field>
        ) : null}
        {entry.payments?.length || entry.type === 'COST' ? (
          <Field label={`Pagamentos/recebimentos registrados (${entry.payments?.length ?? 0})`}>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-slate-800">Pago {formatCurrency(paidAmount)}</span>
                <span className="text-slate-500">Restante {formatCurrency(remainingAmount)}</span>
              </div>
              {(entry.payments ?? []).length ? (
                <ul className="max-h-48 divide-y divide-dashed divide-slate-200 overflow-y-auto border-y border-dashed border-slate-200">
                  {(entry.payments ?? []).map((payment, index) => (
                    <li key={payment.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium leading-5 text-slate-500">Pagamento {index + 1}</p>
                          <p className="text-sm font-semibold leading-5 text-slate-900">{formatCurrency(payment.amount)}</p>
                          {payment.refundedAmount > 0 ? <p className="text-xs text-violet-700">Estornado: {formatCurrency(payment.refundedAmount)}</p> : null}
                          <p className="text-xs leading-5 text-slate-500">{EVENT_PAYMENT_METHOD_LABELS[payment.paymentMethod]} · {formatDate(payment.paidAt)}</p>
                        </div>
                        {payment.status === 'REFUNDED' ? <span className="shrink-0 text-xs font-medium text-violet-700">Estornado</span> : payment.refundedAmount > 0 ? <span className="shrink-0 text-xs font-medium text-violet-700">Parcialmente estornado</span> : null}
                      </div>
                      {payment.notes ? <p className="mt-1 text-xs leading-5 text-slate-600">{payment.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">Nenhum pagamento individual registrado.</p>
              )}
            </div>
          </Field>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
