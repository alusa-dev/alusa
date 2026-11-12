'use client';

import { calculateEnrollmentFinancialCondition } from '@alusa/domain';

type EnrollmentFinancialConditionDetailsProps = {
  condition?: 'NORMAL' | 'BOLSA_PARCIAL' | 'ISENCAO_INTEGRAL';
  percentage?: number | null;
  reason?: string | null;
  validUntil?: string | null;
  originalMonthlyAmount: number;
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';

function formatDate(value?: string | null) {
  if (!value) return 'Não informada';
  const dateKey = value.slice(0, 10);
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? 'Não informada' : date.toLocaleDateString('pt-BR');
}

export function EnrollmentFinancialConditionDetails({
  condition = 'NORMAL',
  percentage,
  reason,
  validUntil,
  originalMonthlyAmount,
}: EnrollmentFinancialConditionDetailsProps) {
  const pricing = calculateEnrollmentFinancialCondition(originalMonthlyAmount, {
    condicaoFinanceira: condition,
    condicaoPercentual: percentage,
  });
  const conditionLabel = condition === 'ISENCAO_INTEGRAL'
    ? 'Isenção integral (100%)'
    : condition === 'BOLSA_PARCIAL'
      ? `Bolsa parcial (${percentage ?? 0}%)`
      : 'Pagamento normal';

  return (
    <section className={sectionClass} aria-labelledby="enrollment-financial-condition-title">
      <div>
        <h2 id="enrollment-financial-condition-title" className="text-sm font-semibold text-slate-700">
          Condição financeira
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Registrada no ato da matrícula. Informações somente para consulta.
        </p>
      </div>

      <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-4">
        <div className="flex items-start justify-between gap-6 py-3 text-sm">
          <span className="text-slate-600">Condição registrada</span>
          <span className="text-right font-medium text-slate-900">{conditionLabel}</span>
        </div>
        {condition !== 'NORMAL' ? (
          <>
            <div className="flex items-start justify-between gap-6 py-3 text-sm">
              <span className="text-slate-600">Motivo da concessão</span>
              <span className="text-right text-slate-900">{reason?.trim() || 'Não informado'}</span>
            </div>
            <div className="flex items-start justify-between gap-6 py-3 text-sm">
              <span className="text-slate-600">Validade registrada</span>
              <span className="text-right text-slate-900">Até {formatDate(validUntil)}</span>
            </div>
          </>
        ) : null}
        <div className="flex items-start justify-between gap-6 py-3 text-sm">
          <span className="text-slate-600">Mensalidade original</span>
          <span className="tabular-nums text-slate-900">{currency.format(pricing.baseAmount)}</span>
        </div>
        <div className="flex items-start justify-between gap-6 py-3 text-sm">
          <span className="text-slate-600">Benefício aplicado</span>
          <span className="tabular-nums text-emerald-700">− {currency.format(pricing.benefitAmount)}</span>
        </div>
        <div className="flex items-start justify-between gap-6 py-3 text-sm font-semibold text-slate-900">
          <span>Valor mensal registrado</span>
          <span className="tabular-nums">{currency.format(pricing.monthlyAmount)}</span>
        </div>
      </div>

      {condition !== 'NORMAL' ? (
        <p className="text-xs text-slate-500">
          A validade registra o período acordado; ela não altera cobranças automaticamente.
        </p>
      ) : null}
    </section>
  );
}
