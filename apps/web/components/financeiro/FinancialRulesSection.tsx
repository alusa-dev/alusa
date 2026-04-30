'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  controlClass,
  labelClass,
  sectionClass,
  formatBRLInput,
  formatPercentInput,
  DISCOUNT_DUE_DATE_OPTIONS,
  type MultaTipo,
  type DescontoTipo,
  type FinancialRulesState,
} from '@/lib/finance-form-utils';

interface FinancialRulesSectionProps {
  state: FinancialRulesState;
  onChangeField: <K extends keyof FinancialRulesState>(_field: K, _value: FinancialRulesState[K]) => void;
  showInterestFixed?: boolean;
}

export function FinancialRulesSection({
  state,
  onChangeField,
  showInterestFixed = false,
}: FinancialRulesSectionProps) {
  return (
    <>
      {/* Juros e multa */}
      <section className={sectionClass}>
        <h3 className="text-sm font-semibold text-slate-900">Juros e multa</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Juros ao mês (%)</label>
            <Input
              className={controlClass}
              value={state.interestPercent}
              onChange={(e) => onChangeField('interestPercent', formatPercentInput(e.target.value))}
              placeholder="0,00"
            />
          </div>

          {showInterestFixed && (
            <div>
              <label className={labelClass}>Valor fixo de juros ao mês</label>
              <Input
                className={controlClass}
                value={state.interestFixed}
                onChange={(e) => onChangeField('interestFixed', formatBRLInput(e.target.value))}
                placeholder="R$ 0,00"
              />
            </div>
          )}

          <div>
            <label className={labelClass}>Tipo de multa</label>
            <Select value={state.fineType} onValueChange={(v: MultaTipo) => onChangeField('fineType', v)}>
              <SelectTrigger className={controlClass}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENTAGE">Percentual</SelectItem>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClass}>
              {state.fineType === 'PERCENTAGE' ? 'Multa (%)' : 'Multa (R$)'}
            </label>
            <Input
              className={controlClass}
              value={state.fineType === 'PERCENTAGE' ? state.finePercent : state.fineFixed}
              onChange={(e) =>
                state.fineType === 'PERCENTAGE'
                  ? onChangeField('finePercent', formatPercentInput(e.target.value))
                  : onChangeField('fineFixed', formatBRLInput(e.target.value))
              }
              placeholder={state.fineType === 'PERCENTAGE' ? '0,00' : 'R$ 0,00'}
            />
          </div>
        </div>
      </section>

      {/* Desconto */}
      <section className={sectionClass}>
        <h3 className="text-sm font-semibold text-slate-900">Desconto</h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Tipo de desconto</label>
            <Select value={state.discountType} onValueChange={(v: DescontoTipo) => onChangeField('discountType', v)}>
              <SelectTrigger className={controlClass}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENTAGE">Percentual</SelectItem>
                <SelectItem value="FIXED">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className={labelClass}>
              {state.discountType === 'PERCENTAGE' ? 'Desconto (%)' : 'Desconto (R$)'}
            </label>
            <Input
              className={controlClass}
              value={state.discountType === 'PERCENTAGE' ? state.discountPercent : state.discountFixed}
              onChange={(e) =>
                state.discountType === 'PERCENTAGE'
                  ? onChangeField('discountPercent', formatPercentInput(e.target.value))
                  : onChangeField('discountFixed', formatBRLInput(e.target.value))
              }
              placeholder={state.discountType === 'PERCENTAGE' ? '0,00' : 'R$ 0,00'}
            />
          </div>

          <div>
            <label className={labelClass}>Limite para desconto (dias)</label>
            <Select
              value={state.discountDueDateLimitDays}
              onValueChange={(v) => onChangeField('discountDueDateLimitDays', v)}
            >
              <SelectTrigger className={controlClass}>
                <SelectValue placeholder="Selecione o prazo de desconto" />
              </SelectTrigger>
              <SelectContent>
                {DISCOUNT_DUE_DATE_OPTIONS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days === 0 ? 'Até o vencimento' : `${days} dia(s) antes`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
    </>
  );
}
