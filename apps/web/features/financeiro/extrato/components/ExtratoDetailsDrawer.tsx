'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { DetailsDialog, DetailsDialogRow, DetailsDialogSection } from '@/components/shared/DetailsDialog';
import type { LedgerEntry } from '../dtos';
import { formatCurrency, formatDate, formatStatusLabel, formatTypeLabel } from '../utils/extrato-formatters';

interface ExtratoDetailsDrawerProps {
  entry: LedgerEntry;
  onClose: () => void;
}

export function ExtratoDetailsDrawer({ entry, onClose }: ExtratoDetailsDrawerProps) {
  const receiptId = useMemo(() => {
    const suffix = entry.paymentId ?? entry.id;
    return `#${suffix.slice(-8).toUpperCase()}`;
  }, [entry.id, entry.paymentId]);

  const isTaxa = entry.type === 'TAXA';
  const hasComprovante = !isTaxa && Boolean(entry.paymentId);
  const heroDescription = entry.description?.trim() || 'Movimentação do ledger oficial';
  const secondaryContext = entry.chargeName ?? entry.customerName ?? null;
  const heroTitle = entry.status === 'CONFIRMADO' ? 'Movimentação confirmada' : 'Detalhes da transação';
  const heroAmount = entry.status === 'CONFIRMADO' ? entry.grossValue : entry.netValue;
  const amountClass = entry.grossValue >= 0 ? 'text-slate-950' : 'text-rose-700';

  return (
    <DetailsDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Detalhes da movimentação"
      footer={
        <div className="grid w-full gap-3">
          <Button type="button" variant="outline" className="h-10 w-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={onClose}>
            Fechar
          </Button>
          {hasComprovante && (
            <Button
              type="button"
              className="h-10 w-full"
              onClick={() => window.open(`/api/financeiro/extrato/${encodeURIComponent(entry.paymentId!)}/comprovante`, '_blank', 'noopener,noreferrer')}
            >
              Ver comprovante
            </Button>
          )}
        </div>
      }
    >
      <section className="space-y-4">
        <div>
          <p className="text-xs text-slate-500">{heroTitle}</p>
          <p className={`mt-1 text-3xl font-medium tracking-tight ${amountClass}`}>
            {formatCurrency(heroAmount, { absolute: true })}
          </p>
          <p className="mt-1 text-xs text-slate-400">{formatDate(entry.date)} · ID: {receiptId}</p>
        </div>
      </section>

      <div data-testid="drawer-description">
        <DetailsDialogSection>
        <DetailsDialogRow label="Descrição" value={heroDescription} />
        <DetailsDialogRow label="Valor líquido" value={formatCurrency(entry.netValue, { absolute: true })} />
        <DetailsDialogRow label="Método" value={formatTypeLabel(entry.type)} />
        <DetailsDialogRow label="Status" value={formatStatusLabel(entry.status)} />
        {secondaryContext && <DetailsDialogRow label="Referência" value={secondaryContext} />}
        <DetailsDialogRow label="ID" value={receiptId} />
          {entry.paymentId && <DetailsDialogRow label="Pagamento" value={entry.paymentId} />}
        </DetailsDialogSection>
      </div>
    </DetailsDialog>
  );
}
