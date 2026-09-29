'use client';

import type { ReactNode } from 'react';
import type { InventoryMovementType, RestockOrderStatus } from '@prisma/client';

import { Help } from '@/components/icons/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { BadgeVariant } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  OPENING_IN: 'Saldo inicial',
  ENTRY_IN: 'Entrada manual',
  RESTOCK_IN: 'Recebimento de reposição',
  SALE_OUT: 'Saída por venda',
  RESERVE: 'Reserva de venda',
  RELEASE: 'Liberação de reserva',
  RETURN_IN: 'Devolução',
  ADJUST_IN: 'Correção positiva',
  ADJUST_OUT: 'Correção negativa',
  LOSS_OUT: 'Perda',
};

export const MOVEMENT_BADGE_VARIANTS: Record<InventoryMovementType, BadgeVariant> = {
  OPENING_IN: 'neutral',
  ENTRY_IN: 'success',
  RESTOCK_IN: 'success',
  SALE_OUT: 'warning',
  RESERVE: 'info',
  RELEASE: 'neutral',
  RETURN_IN: 'success',
  ADJUST_IN: 'info',
  ADJUST_OUT: 'warning',
  LOSS_OUT: 'destructive',
};

export const RESTOCK_STATUS_LABELS: Record<RestockOrderStatus, string> = {
  PLANEJADO: 'Em aberto',
  RECEBIDO_PARCIAL: 'Recebido parcialmente',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
};

export const RESTOCK_STATUS_BADGE_VARIANTS: Record<RestockOrderStatus, BadgeVariant> = {
  PLANEJADO: 'info',
  RECEBIDO_PARCIAL: 'warning',
  RECEBIDO: 'success',
  CANCELADO: 'neutral',
};

export function formatInventoryCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

export function formatInventoryDate(value: string | null | undefined): string {
  if (!value) return 'Sem previsão';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatInventoryDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatSignedQuantity(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

export function formatOriginLabel(originType: string, originActionKey: string): string {
  if (originType === 'BACKFILL') return 'Importação inicial';
  if (originType === 'MANUAL_ENTRY') return 'Adicionado manualmente';
  if (originType === 'MANUAL_ADJUSTMENT') {
    return originActionKey === 'set' ? 'Contagem física' : 'Mudança manual';
  }
  if (originType === 'RESTOCK_ORDER') {
    if (originActionKey === 'planned') return 'Reposição planejada';
    if (originActionKey === 'cancel') return 'Reposição cancelada';
    if (originActionKey.startsWith('receive:')) return 'Reposição recebida';
    return 'Reposição';
  }
  if (originType === 'SALE') {
    if (originActionKey === 'reserve') return 'Venda reservada';
    if (originActionKey === 'sale-out') return 'Venda entregue';
    if (originActionKey === 'fulfill') return 'Reserva entregue';
    if (originActionKey === 'cancel') return 'Venda cancelada';
    if (originActionKey.startsWith('return:')) return 'Devolução de venda';
    return 'Venda';
  }
  return originType.replaceAll('_', ' ').toLowerCase();
}

interface InfoTooltipProps {
  content: ReactNode;
  label?: string;
  className?: string;
}

export function InfoTooltip({ content, label = 'Mais informações', className }: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2',
              className,
            )}
          >
            <Help className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-left leading-relaxed">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface LabelWithTooltipProps {
  children: ReactNode;
  tooltip: ReactNode;
  className?: string;
}

export function LabelWithTooltip({ children, tooltip, className }: LabelWithTooltipProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span>{children}</span>
      <InfoTooltip content={tooltip} />
    </span>
  );
}

interface InventoryMetricCardProps {
  label: string;
  detail: string;
  value: ReactNode;
  icon: ReactNode;
  tooltip?: ReactNode;
}

export function InventoryMetricCard({
  label,
  detail,
  value,
  icon,
  tooltip,
}: InventoryMetricCardProps) {
  return (
    <div className="flex min-h-[132px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
      <div>
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e9dffc] text-[#2b2634]">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold tracking-wide text-[#2b2634]">{label}</p>
              {tooltip ? <InfoTooltip content={tooltip} /> : null}
            </div>
            <p className="mt-0.5 text-[11px] leading-4 text-[#2b2634]/65">{detail}</p>
          </div>
        </div>
      </div>
      <span className="block text-3xl font-semibold tracking-tight text-[#2b2634]">{value}</span>
    </div>
  );
}
