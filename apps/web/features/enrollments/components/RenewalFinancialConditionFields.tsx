'use client';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoCallout } from '@/components/ui/info-callout';
import { StepHeader } from '@/components/shared/wizard/layout';
import { wizardFieldInputClass, wizardTextareaFieldClass } from '@/components/shared/wizard/field-styles';
import { isEnrollmentBenefitValidityInRange } from '@alusa/domain';

export type RenewalFinancialCondition = {
  kind: 'NORMAL' | 'BOLSA_PARCIAL' | 'ISENCAO_INTEGRAL';
  percentage?: number;
  reason?: string;
  reasonChoice?: string;
  otherReason?: string;
  validityMode?: 'MATRICULA' | 'PERIODO';
  validUntil?: string;
};

export type RenewalFinancialConditionInput = {
  kind: RenewalFinancialCondition['kind'];
  percentage?: number;
  reason?: string;
  validUntil?: string;
};

const REASONS = [
  'Bolsa de estudos',
  'Convênio',
  'Desempenho acadêmico',
  'Campanha promocional',
  'Acordo comercial',
  'Outro',
] as const;

export function toRenewalFinancialConditionInput(
  value: RenewalFinancialCondition,
  endDate: string,
): RenewalFinancialConditionInput {
  if (value.kind === 'NORMAL') return { kind: 'NORMAL' };
  return {
    kind: value.kind,
    ...(value.kind === 'BOLSA_PARCIAL' ? { percentage: value.percentage } : {}),
    reason: value.reasonChoice === 'Outro' ? value.otherReason?.trim() : value.reasonChoice?.trim(),
    validUntil: value.validityMode === 'PERIODO' ? value.validUntil : endDate,
  };
}

export function getRenewalFinancialConditionError(
  value: RenewalFinancialCondition,
  startDate: string,
  endDate: string,
): string | null {
  if (value.kind === 'NORMAL') return null;
  const reason = value.reasonChoice === 'Outro' ? value.otherReason : value.reasonChoice;
  if (!reason?.trim()) return 'Informe o motivo da condição financeira.';
  if (value.kind === 'BOLSA_PARCIAL' && (
    value.percentage == null || !Number.isFinite(value.percentage) || value.percentage < 1 || value.percentage > 99
  )) return 'Informe um percentual entre 1% e 99%.';
  const validUntil = value.validityMode === 'PERIODO' ? value.validUntil : endDate;
  if (!validUntil || !isEnrollmentBenefitValidityInRange(validUntil, startDate, endDate)) {
    return 'A validade deve estar dentro do período do novo ciclo.';
  }
  return null;
}

type Props = {
  studentName: string;
  currentCondition?: {
    kind?: string | null;
    percentage?: number | null;
    reason?: string | null;
    validUntil?: string | null;
  } | null;
  value: RenewalFinancialCondition;
  startDate: string;
  endDate: string;
  baseAmount: number;
  groupId: string;
  showHeader?: boolean;
  onChange: (_value: RenewalFinancialCondition) => void;
};

function labelForCondition(kind?: string | null, percentage?: number | null) {
  if (kind === 'ISENCAO_INTEGRAL') return 'Isenção integral';
  if (kind === 'BOLSA_PARCIAL') return `Bolsa parcial${percentage != null ? ` (${percentage}%)` : ''}`;
  return 'Pagamento normal';
}

function formatDate(value?: string | null) {
  if (!value) return 'sem validade registrada';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'sem validade registrada' : date.toLocaleDateString('pt-BR');
}

export function RenewalFinancialConditionFields({
  studentName,
  currentCondition,
  value,
  startDate,
  endDate,
  baseAmount,
  groupId,
  showHeader = true,
  onChange,
}: Props) {
  const hasCurrentCondition = currentCondition?.kind && currentCondition.kind !== 'NORMAL';
  const kind = value.kind;
  const percentage = value.percentage ?? 50;
  const validityMode = value.validityMode ?? 'MATRICULA';
  const reasonChoice = value.reasonChoice ?? '';
  const amount = Math.max(0, Number.isFinite(baseAmount) ? baseAmount : 0);
  const benefitPercentage = kind === 'ISENCAO_INTEGRAL' ? 100 : kind === 'BOLSA_PARCIAL' ? percentage : 0;
  const benefitAmount = Math.round((amount * benefitPercentage + Number.EPSILON) * 100) / 100;
  const monthlyAmount = Math.max(0, Math.round((amount - benefitAmount + Number.EPSILON) * 100) / 100);
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const setKind = (nextKind: RenewalFinancialCondition['kind']) => onChange(nextKind === 'NORMAL' ? { kind: 'NORMAL' } : {
    ...value,
    kind: nextKind,
    ...(nextKind === 'BOLSA_PARCIAL' ? { percentage: value.percentage ?? 50 } : {}),
    ...{
      reasonChoice: value.reasonChoice ?? '',
      otherReason: value.otherReason ?? '',
      validityMode: value.validityMode ?? 'MATRICULA',
      validUntil: value.validUntil ?? endDate,
    },
  });

  return (
    <div className="alusa-wizard-fields space-y-4">
      {showHeader ? (
        <StepHeader title="Benefício na mensalidade" hint="Defina o benefício aplicado à mensalidade deste novo ciclo." />
      ) : null}
      {hasCurrentCondition ? (
        <InfoCallout variant="info" size="sm" showIcon={false}>
          <strong>Condição atual de {studentName}:</strong>{' '}
          {labelForCondition(currentCondition.kind, currentCondition.percentage)}
          {currentCondition.reason ? ` · ${currentCondition.reason}` : ''}
          {' · '}válida até {formatDate(currentCondition.validUntil)}. Ela não é transferida automaticamente para o novo ciclo.
        </InfoCallout>
      ) : null}

      <fieldset className="space-y-0">
        <legend className="sr-only">Benefício na mensalidade de {studentName} para o próximo ciclo</legend>
        {([
          ['NORMAL', 'Pagamento normal'],
          ['BOLSA_PARCIAL', 'Bolsa parcial'],
          ['ISENCAO_INTEGRAL', 'Isenção integral (100%)'],
        ] as const).map(([option, title]) => {
          const selected = kind === option;
          return (
            <label key={option} className={`flex min-h-9 w-full cursor-pointer items-center gap-3 py-1.5 text-left text-[15px] leading-5 text-[#3D3A3F] ${selected ? 'font-medium' : 'font-normal'}`}>
              <input
                type="radio"
                name={`renewal-condition-${groupId}`}
                value={option}
                checked={selected}
                onChange={() => setKind(option)}
                className="peer sr-only"
              />
              <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#361D56] peer-focus-visible:ring-offset-2 ${selected ? '' : 'border border-[#B9B9B9] bg-white'}`}>
                {selected && <img src="/images/enrollments/financial-condition/radio-selected.svg" alt="" width="20" height="20" />}
              </span>
              {title}
            </label>
          );
        })}
      </fieldset>

      {kind !== 'NORMAL' ? (
        <div className="space-y-5">
          <div className="border-t border-[#E2E0E6]" aria-hidden="true" />
          <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
            <span>Motivo da concessão</span>
            <Select
              value={reasonChoice}
              onValueChange={(reasonChoice) => onChange({ ...value, reasonChoice })}
            >
              <SelectTrigger className={`${wizardFieldInputClass} alusa-select-trigger text-[13px] [&>svg]:hidden`}>
                <SelectValue placeholder="Selecione um motivo" />
                <img src="/images/enrollments/financial-condition/reason-chevron.svg" alt="" width="16" height="16" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {reasonChoice === 'Outro' ? (
            <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              <span>Descreva o motivo</span>
              <Textarea
                value={value.otherReason ?? ''}
                rows={3}
                maxLength={500}
                onChange={(event) => onChange({ ...value, otherReason: event.target.value })}
                className={wizardTextareaFieldClass}
              />
            </label>
          ) : null}

          {kind === 'BOLSA_PARCIAL' ? (
            <label className="block space-y-2 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              <span className="flex items-center justify-between">
                <span>Percentual da bolsa</span>
                <span className="text-[13px] font-semibold text-slate-800">{percentage}%</span>
              </span>
              <input
                aria-label={`Percentual da bolsa para ${studentName}`}
                type="range"
                min="1"
                max="99"
                step="1"
                value={percentage}
                onChange={(event) => onChange({ ...value, percentage: Number(event.target.value) })}
                style={{ background: `linear-gradient(to right, #361D56 0%, #361D56 ${percentage}%, #E2E0E6 ${percentage}%, #E2E0E6 100%)` }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-transparent accent-[#361D56] [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#361D56] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#361D56]"
              />
            </label>
          ) : null}

          <fieldset className="space-y-1" aria-label={`Validade da condição de ${studentName}`}>
            <legend className="mb-1.5 text-[13px] font-medium leading-5 text-[#717171]">Validade do benefício</legend>
            {([
              ['MATRICULA', 'Até o término da matrícula'],
              ['PERIODO', 'Por período determinado'],
            ] as const).map(([mode, label]) => (
              <label key={mode} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm leading-5 text-[#3D3A3F]">
                <input
                  type="radio"
                  name={`renewal-validity-${groupId}`}
                  checked={validityMode === mode}
                  onChange={() => onChange({ ...value, validityMode: mode, ...(mode === 'MATRICULA' ? { validUntil: endDate } : {}) })}
                  className="h-5 w-5 accent-[#361D56]"
                />
                {label}
              </label>
            ))}
          </fieldset>

          {validityMode === 'PERIODO' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                <span>Data de início</span>
                <div className="relative">
                  <Input type="date" value={startDate} readOnly className={`${wizardFieldInputClass} pr-10 [&::-webkit-calendar-picker-indicator]:opacity-0`} />
                  <img src="/images/enrollments/financial-condition/calendar.svg" alt="" width="12" height="13" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </label>
              <label className="block space-y-1 text-xs font-medium leading-4 text-slate-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                <span>Data de término</span>
                <div className="relative">
                  <Input type="date" value={value.validUntil ?? ''} onChange={(event) => onChange({ ...value, validUntil: event.target.value || undefined })} min={startDate || undefined} max={endDate || undefined} className={`${wizardFieldInputClass} pr-10 [&::-webkit-calendar-picker-indicator]:opacity-0`} />
                  <img src="/images/enrollments/financial-condition/calendar.svg" alt="" width="12" height="13" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
              </label>
            </div>
          ) : null}

          <p className="text-xs leading-[18px] text-slate-500">A validade registra o período acordado. A cobrança não muda automaticamente; revise manualmente as condições na data informada.</p>
        </div>
      ) : null}

      <section className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5" aria-label={`Prévia da mensalidade de ${studentName}`}>
        <h3 className="mb-3 text-[13px] font-medium leading-5 text-slate-600">Prévia da mensalidade</h3>
        <dl className="space-y-2 text-sm leading-5">
          <div className="flex justify-between gap-4"><dt className="text-[#717171]">Mensalidade original</dt><dd className="text-right tabular-nums">{formatter.format(amount)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[#717171]">Benefício aplicado ({benefitPercentage}%)</dt><dd className="text-right tabular-nums text-[#006E33]">− {formatter.format(benefitAmount)}</dd></div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-3">
            <dt className="font-medium text-[#1F2937]">Valor mensal</dt>
            <dd className="text-right text-[22px] font-medium leading-7 tabular-nums text-[#1F2937]">{formatter.format(monthlyAmount)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-[18px] text-[#717171]">
          {monthlyAmount === 0 ? 'Não haverá cobrança mensal com esta condição.' : 'O valor líquido será utilizado para gerar as cobranças.'}
        </p>
      </section>
    </div>
  );
}
