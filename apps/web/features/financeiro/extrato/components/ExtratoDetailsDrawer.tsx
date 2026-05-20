'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Close,
  CreditCard,
  DocumentText,
  Download,
  Finance,
  RectangleStack,
} from '@/components/icons/icons';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { LedgerEntry } from '../dtos';
import { formatCurrency, formatDate, formatStatusLabel, formatTypeLabel } from '../utils/extrato-formatters';

interface ExtratoDetailsDrawerProps {
  entry: LedgerEntry;
  onClose: () => void;
}

export function ExtratoDetailsDrawer({ entry, onClose }: ExtratoDetailsDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    closeTimeoutRef.current = setTimeout(onClose, 240);
  }, [onClose]);

  useEffect(() => {
    setMounted(true);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };

    window.addEventListener('keydown', handleEsc);

    return () => {
      window.removeEventListener('keydown', handleEsc);
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, [handleClose]);

  const receiptId = useMemo(() => {
    const suffix = entry.paymentId ?? entry.id;
    return `#${suffix.slice(-8).toUpperCase()}`;
  }, [entry.id, entry.paymentId]);

  const isCredit = entry.grossValue >= 0;
  const isTaxa = entry.type === 'TAXA';
  const hasComprovante = !isTaxa && Boolean(entry.paymentId);
  const heroDescription = entry.description?.trim() || 'Movimentação do ledger oficial';
  const secondaryContext = entry.chargeName ?? entry.customerName ?? null;
  const heroTitle = entry.status === 'CONFIRMADO' ? 'Movimentação confirmada' : 'Detalhes da transação';
  const heroAmount = entry.status === 'CONFIRMADO' ? entry.grossValue : entry.netValue;
  const amountToneClass = isCredit ? 'text-slate-900' : 'text-rose-700';
  const methodLabel = formatTypeLabel(entry.type);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-end p-3 sm:p-4 lg:p-5" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            aria-hidden="true"
          />

          <motion.div
            data-testid="extrato-details-drawer"
            className="relative flex h-[calc(100vh-24px)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.18)] sm:h-[calc(100vh-32px)] sm:max-w-[430px]"
            initial={{ opacity: 0, x: 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          >
            <button
              type="button"
              onClick={handleClose}
              className="absolute right-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Fechar"
            >
              <Close className="h-5 w-5" />
            </button>

            <div className="flex-1 overflow-y-auto bg-white px-6 pb-6 pt-12">
              <div className="space-y-5">
                <section className="space-y-3 text-center" data-testid="extrato-hero-card">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                    <DocumentText className="h-7 w-7 text-slate-500" />
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-sm font-medium text-slate-500">
                      {heroTitle}
                    </h2>
                    <p className={cn('text-[36px] font-semibold tracking-[-0.03em]', amountToneClass)}>
                      {formatCurrency(heroAmount, { absolute: true })}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(entry.date)}{' · '}ID: {receiptId}
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white" data-testid="drawer-description">
                  <div className="divide-y divide-slate-100">
                    <DetailRow label="Descrição" value={heroDescription} icon={Finance} />
                    <DetailRow label="Valor líquido" value={formatCurrency(entry.netValue, { absolute: true })} icon={RectangleStack} />
                    <DetailRow label="Método" value={methodLabel} icon={CreditCard} />
                    <DetailRow label="Status" value={formatStatusLabel(entry.status)} icon={DocumentText} />
                    {secondaryContext && (
                      <DetailRow label="Referência" value={secondaryContext} icon={Calendar} />
                    )}
                  </div>

                  {(receiptId || entry.paymentId) && (
                    <div className="mx-4 mb-4 mt-1 rounded-lg bg-slate-50 px-4 py-3 space-y-1.5">
                      <MetaLine label="ID" value={receiptId} />
                      {entry.paymentId && (
                        <MetaLine label="Pagamento" value={entry.paymentId} valueClassName="break-all font-mono text-[11px]" />
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>

            <div className="border-t border-slate-100 bg-white px-6 py-5">
              <div className={cn('grid gap-3', hasComprovante ? 'grid-cols-2' : 'grid-cols-1')}>
                <Button
                  variant="outline"
                  className="h-10 rounded-lg border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  onClick={handleClose}
                >
                  <Calendar className="h-4 w-4" />
                  Voltar ao extrato
                </Button>

                {hasComprovante && (
                  <Button
                    className="h-10 rounded-lg text-sm font-medium"
                    onClick={() => window.open(`/api/financeiro/extrato/${encodeURIComponent(entry.paymentId!)}/comprovante`, '_blank', 'noopener,noreferrer')}
                  >
                    <Download className="h-4 w-4" />
                    Ver comprovante
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function DetailRow({ 
  label, 
  value, 
  icon: Icon, 
}: { 
  label: string; 
  value: string; 
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4" data-testid="detail-row">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
        <span className="min-w-0 text-sm font-medium leading-5 text-slate-600">{label}</span>
      </div>
      <span className="max-w-[56%] break-words text-right text-sm font-semibold leading-5 text-slate-700 tabular-nums">
        {value}
      </span>
    </div>
  );
}

function MetaLine({
  label,
  value,
  icon: Icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-400" /> : null}
        <span>{label}</span>
      </div>
      <span className={cn('text-right text-sm font-semibold text-slate-700', valueClassName)}>{value}</span>
    </div>
  );
}
