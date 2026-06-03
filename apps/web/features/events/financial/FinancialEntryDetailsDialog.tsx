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
  onOpenChange: (open: boolean) => void;
}) {
  const details = [
    ['Tipo', entry.type === 'COST' ? 'Custo' : 'Receita'],
    ['Categoria', entry.category],
    ['Previsto', formatCurrency(entry.expectedAmount)],
    ['Realizado', formatCurrency(entry.actualAmount ?? 0)],
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
        <div className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
            </div>
          ))}
        </div>
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
      </DialogContent>
    </Dialog>
  );
}
