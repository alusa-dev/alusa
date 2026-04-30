'use client';

import type { ReactNode } from 'react';
import { BanknotesIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon, MinusCircleIcon } from '@heroicons/react/24/outline';
import type { ExtratoSummary } from '../dtos';
import { formatCurrency } from '../utils/extrato-formatters';

interface SummaryCardProps {
  label: string;
  detail: string;
  value: number;
  icon: ReactNode;
  tone: 'income' | 'expense' | 'refund' | 'net';
  loading?: boolean;
}

const TONE_STYLES = {
  income: {
    card: 'bg-[#f4ecfd]',
    icon: 'bg-[#e9dffc] text-[#2b2634]',
    label: 'text-[#2b2634]',
    value: 'text-[#2b2634]',
    detail: 'text-[#2b2634]/65',
  },
  expense: {
    card: 'bg-[#f4ecfd]',
    icon: 'bg-[#e9dffc] text-[#2b2634]',
    label: 'text-[#2b2634]',
    value: 'text-[#2b2634]',
    detail: 'text-[#2b2634]/65',
  },
  refund: {
    card: 'bg-[#f4ecfd]',
    icon: 'bg-[#e9dffc] text-[#2b2634]',
    label: 'text-[#2b2634]',
    value: 'text-[#2b2634]',
    detail: 'text-[#2b2634]/65',
  },
  net: {
    card: 'bg-[#f4ecfd]',
    icon: 'bg-[#e9dffc] text-[#2b2634]',
    label: 'text-[#2b2634]',
    value: 'text-[#2b2634]',
    detail: 'text-[#2b2634]/65',
  },
} as const;

function SummaryCard({ label, detail, value, icon, tone, loading }: SummaryCardProps) {
  const styles = TONE_STYLES[tone];

  if (loading) {
    return (
      <div className="flex min-h-[148px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 animate-pulse">
        <div>
          <div className="mb-3 h-4 w-28 rounded bg-[#e9dffc]" />
          <div className="h-8 w-32 rounded bg-[#e9dffc]" />
        </div>
        <div className="h-4 w-40 rounded bg-[#e9dffc]" />
      </div>
    );
  }

  return (
    <div className={`flex min-h-[148px] flex-col justify-between rounded-2xl px-5 py-4 ${styles.card}`}>
      <div>
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${styles.icon}`}>
            {icon}
          </div>
          <div>
            <p className={`text-[13px] font-semibold tracking-wide ${styles.label}`}>{label}</p>
            <p className={`text-[11px] ${styles.detail}`}>{detail}</p>
          </div>
        </div>
        <span className={`block text-3xl font-semibold tracking-tight ${styles.value}`}>
          {formatCurrency(value)}
        </span>
      </div>
    </div>
  );
}

interface ExtratoSummaryCardsProps {
  summary: ExtratoSummary;
  loading?: boolean;
}

export function ExtratoSummaryCards({ summary, loading }: ExtratoSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <SummaryCard
        label="Entradas"
        detail="créditos brutos no período"
        value={summary.receitas}
        icon={<BanknotesIcon className="h-5 w-5" />}
        tone="income"
        loading={loading}
      />
      <SummaryCard
        label="Saídas e taxas"
        detail="impactos negativos no ledger"
        value={summary.despesas}
        icon={<ChartBarIcon className="h-5 w-5" />}
        tone="expense"
        loading={loading}
      />
      <SummaryCard
        label="Estornos"
        detail="reversões e cancelamentos"
        value={summary.estornos}
        icon={<ArrowPathIcon className="h-5 w-5" />}
        tone="refund"
        loading={loading}
      />
      <SummaryCard
        label="Impacto no saldo"
        detail="variação líquida do período"
        value={summary.liquido}
        icon={<MinusCircleIcon className="h-5 w-5" />}
        tone="net"
        loading={loading}
      />
    </div>
  );
}
