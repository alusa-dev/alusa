'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionCard, StepHeader } from '@/components/shared/wizard/layout';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';
import { calculateFamilyMonthlyTotal, calculateFamilyBenefitTotal } from '../family-pricing';
import type { WizardContextValue } from '../types';
import { calcularDescontoCondicao, getConditionValidityMode } from '../financial-condition';

interface StepFinancialConditionProps {
  ctx: WizardContextValue;
  contaId?: string;
}

type ValidityMode = 'MATRICULA' | 'PERIODO';
const REASONS = [
  'Bolsa de estudos',
  'Convênio',
  'Desempenho acadêmico',
  'Campanha promocional',
  'Acordo comercial',
  'Outro',
] as const;

/** Financial terms are an enrollment agreement, not a reusable discount catalog. */
export function StepFinancialCondition({ ctx }: StepFinancialConditionProps) {
  const { state, update } = ctx;
  const kind = state.condicaoFinanceira ?? 'NORMAL';
  const isFamily = state.modoMatricula === 'FAMILIAR';
  const base = isFamily
    ? state.modoTurmas === 'COMBO'
      ? state.alunosFamiliares.reduce((sum, student) => sum + (student.comboValor ?? 0), 0)
      : (state.planoValor ?? 0) * state.alunosFamiliares.length
    : state.modoTurmas === 'COMBO' ? state.comboValor ?? 0 : state.planoValor ?? 0;
  const percentage = state.condicaoPercentual ?? 50;
  const pricingState = { ...state, condicaoPercentual: percentage };
  const discount = isFamily ? calculateFamilyBenefitTotal(pricingState) : calcularDescontoCondicao(base, pricingState);
  const net = isFamily ? calculateFamilyMonthlyTotal(pricingState) : Math.max(0, Math.round((base - discount + Number.EPSILON) * 100) / 100);
  const formatter = useMemo(() => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }), []);
  const validityMode = getConditionValidityMode(state);
  const reasonIsStandard = REASONS.some((reason) => reason !== 'Outro' && reason === state.condicaoMotivo);
  const [reasonChoice, setReasonChoice] = useState<string>(
    state.condicaoMotivo ? (reasonIsStandard ? state.condicaoMotivo : 'Outro') : '',
  );
  const [otherReason, setOtherReason] = useState(reasonIsStandard ? '' : state.condicaoMotivo ?? '');
  const periodStart = state.dataInicio ?? '';
  const isBenefit = kind !== 'NORMAL';

  useEffect(() => {
    if (kind === 'BOLSA_PARCIAL' && typeof state.condicaoPercentual !== 'number') {
      update({ condicaoPercentual: 50 });
    }
  }, [kind, state.condicaoPercentual, update]);

  const setKind = (condicaoFinanceira: 'NORMAL' | 'BOLSA_PARCIAL' | 'ISENCAO_INTEGRAL') => {
    if (condicaoFinanceira === 'NORMAL') {
      setReasonChoice('');
      setOtherReason('');
    }
    update({
      condicaoFinanceira,
      condicaoMotivo: condicaoFinanceira === 'NORMAL' ? '' : state.condicaoMotivo ?? '',
      condicaoPercentual: condicaoFinanceira === 'BOLSA_PARCIAL' ? state.condicaoPercentual ?? 50 : undefined,
      condicaoValidaAte: condicaoFinanceira === 'NORMAL' ? undefined : state.condicaoValidaAte ?? state.dataFimContrato,
      condicaoValidadeModo: condicaoFinanceira === 'NORMAL' ? 'MATRICULA' : validityMode,
    });
  };

  const setValidityMode = (mode: ValidityMode) => {
    update({ condicaoValidadeModo: mode, condicaoValidaAte: mode === 'MATRICULA' ? state.dataFimContrato : undefined });
  };

  const setReason = (choice: string) => {
    setReasonChoice(choice);
    update({ condicaoMotivo: choice === 'Outro' ? otherReason : choice });
  };

  return (
    <SectionCard>
      <StepHeader title="Condição financeira" hint="Defina como serão cobradas as mensalidades desta matrícula." />

      <fieldset className="space-y-0">
        <legend className="sr-only">Condição financeira da matrícula</legend>
        {([
          ['NORMAL', 'Pagamento normal'],
          ['BOLSA_PARCIAL', 'Bolsa parcial'],
          ['ISENCAO_INTEGRAL', 'Isenção integral (100%)'],
        ] as const).map(([value, title]) => {
          const selected = kind === value;
          return (
            <label
              key={value}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-3 py-1.5 text-left text-[15px] leading-5 text-[#3D3A3F] ${selected ? 'font-medium' : 'font-normal'}`}
            >
              <input type="radio" name="financial-condition" value={value} checked={selected} onChange={() => setKind(value)} className="peer sr-only" />
              <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#361D56] peer-focus-visible:ring-offset-2 ${selected ? '' : 'border border-[#B9B9B9] bg-white'}`}>
                {selected && <img src="/images/enrollments/financial-condition/radio-selected.svg" alt="" width="20" height="20" />}
              </span>
              {title}
            </label>
          );
        })}
      </fieldset>

      {isBenefit && (
        <div className="space-y-5">
          <div className="border-t border-[#E2E0E6]" aria-hidden="true" />
          <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
            <span>Motivo da concessão</span>
            <Select value={reasonChoice} onValueChange={setReason}>
              <SelectTrigger className={`${wizardFieldInputClass} alusa-select-trigger text-[13px] [&>svg]:hidden`}>
                <SelectValue placeholder="Selecione um motivo" />
                <img src="/images/enrollments/financial-condition/reason-chevron.svg" alt="" width="16" height="16" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {reasonChoice === 'Outro' && (
            <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              <span>Descreva o motivo</span>
              <Textarea value={otherReason} rows={3} maxLength={500} onChange={(event) => {
                setOtherReason(event.target.value);
                update({ condicaoMotivo: event.target.value });
              }} className={wizardTextareaFieldClass} />
            </label>
          )}

          {kind === 'BOLSA_PARCIAL' && (
            <label className="block space-y-2 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              <span className="flex items-center justify-between">
                <span>Percentual da bolsa</span>
                <span className="text-[13px] font-semibold text-slate-800">{percentage}%</span>
              </span>
              <input
                aria-label="Percentual da bolsa"
                type="range"
                min="1"
                max="99"
                step="1"
                value={percentage}
                onChange={(event) => update({ condicaoPercentual: Number(event.target.value) })}
                style={{ background: `linear-gradient(to right, #361D56 0%, #361D56 ${percentage}%, #E2E0E6 ${percentage}%, #E2E0E6 100%)` }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-[#361D56] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#361D56] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#361D56]"
              />
            </label>
          )}

          <fieldset className="space-y-1" aria-label="Validade da condição">
            <legend className="mb-1.5 text-[13px] font-medium leading-5 text-[#717171]">Validade do benefício</legend>
            {([
              ['MATRICULA', 'Até o término da matrícula'],
              ['PERIODO', 'Por período determinado'],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm leading-5 text-[#3D3A3F]">
                <input type="radio" name="validity-mode" checked={validityMode === value} onChange={() => setValidityMode(value)} className="h-5 w-5 accent-[#361D56]" />
                {label}
              </label>
            ))}
          </fieldset>
          {validityMode === 'PERIODO' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                <span>Data de início</span>
                <div className="relative">
                  <Input type="date" value={periodStart} readOnly className={`${wizardFieldInputClass} pr-10 [&::-webkit-calendar-picker-indicator]:opacity-0`} />
                  <img src="/images/enrollments/financial-condition/calendar.svg" alt="" width="12" height="13" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </label>
              <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                <span>Data de término</span>
                <div className="relative">
                  <Input type="date" value={state.condicaoValidaAte ?? ''} onChange={(event) => update({ condicaoValidaAte: event.target.value || undefined })} min={periodStart || undefined} className={`${wizardFieldInputClass} pr-10 [&::-webkit-calendar-picker-indicator]:opacity-0`} />
                  <img src="/images/enrollments/financial-condition/calendar.svg" alt="" width="12" height="13" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </label>
            </div>
          )}
          <p className="text-xs leading-[18px] text-slate-500">A validade registra o período acordado. A cobrança não muda automaticamente; revise manualmente as condições na data informada.</p>
        </div>
      )}

      <section className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5" aria-label="Prévia da mensalidade">
        <h3 className="mb-3 text-[13px] font-medium leading-5 text-slate-600">Prévia da mensalidade</h3>
        <dl className="space-y-2 text-sm leading-5">
          <div className="flex justify-between gap-4"><dt className="text-[#717171]">Mensalidade original</dt><dd className="text-right tabular-nums">{formatter.format(base)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#717171]">Benefício aplicado ({kind === 'BOLSA_PARCIAL' ? percentage : kind === 'ISENCAO_INTEGRAL' ? 100 : 0}%)</dt><dd className="text-right tabular-nums text-[#006E33]">− {formatter.format(discount)}</dd></div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3">
            <dt className="font-medium text-[#1F2937]">Valor mensal</dt>
            <dd className="text-right text-[22px] font-medium leading-7 tabular-nums text-[#1F2937]">{formatter.format(net)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-[18px] text-[#717171]">
          {net === 0 ? 'Não haverá cobrança mensal com esta condição.' : 'O valor líquido será utilizado para gerar as cobranças.'}
        </p>
      </section>
    </SectionCard>
  );
}
