'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  filterPisCofinsTaxStatusOptions,
  formatPisCofinsTaxStatusOption,
  getPisCofinsTaxStatusLabel,
  isPisCofinsTaxStatusRequired,
} from '@alusa/finance/fiscal-wizard-client';

import { FiscalAnchoredDropdownPanel } from './FiscalAnchoredDropdownPanel';
import { useFiscalDropdownControl } from './FiscalDropdownScope';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FiscalFieldError,
  FiscalFieldLabel,
  fiscalInputClass,
} from './FiscalWizardFields';

type FiscalPisCofinsTaxStatusFieldProps = {
  value: string;
  error?: string;
  required?: boolean;
  simplesNacional?: boolean;
  useNationalPortal?: boolean;
  onChange: (value: string) => void;
};

export function FiscalPisCofinsTaxStatusField({
  value,
  error,
  required,
  simplesNacional = true,
  useNationalPortal = false,
  onChange,
}: FiscalPisCofinsTaxStatusFieldProps) {
  const dropdownId = useId();
  const { open, setOpen } = useFiscalDropdownControl(dropdownId);
  const [query, setQuery] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);

  const isRequired =
    required ?? isPisCofinsTaxStatusRequired({ simplesNacional, useNationalPortal });

  const selectedLabel = useMemo(() => getPisCofinsTaxStatusLabel(value), [value]);

  const options = useMemo(() => filterPisCofinsTaxStatusOptions(query), [query]);

  useEffect(() => {
    if (!open) setQuery(selectedLabel ?? value);
  }, [open, selectedLabel, value]);

  return (
    <div className={FISCAL_WIZARD_FIELD_CLASS}>
      <FiscalFieldLabel
        label={`Situação tributária PIS/COFINS${isRequired ? ' *' : ''}`}
        help="Códigos oficiais para emissão pelo Portal Nacional. O tipo de retenção é calculado automaticamente com base nas alíquotas informadas."
      />
      <div ref={anchorRef}>
        <Input
          value={open ? query : selectedLabel ? `${value} — ${selectedLabel}` : value}
          placeholder="Busque por código ou descrição — ex.: 01, alíquota básica"
          className={fiscalInputClass(Boolean(error))}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
      </div>
      <FiscalFieldError message={error} />
      {isRequired && !value ? (
        <p className="text-xs text-amber-700">
          Obrigatório para contas do Regime Normal. Confirme o enquadramento com a contabilidade.
        </p>
      ) : null}
      <FiscalAnchoredDropdownPanel
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
      >
        {options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-gray-500">Nenhuma situação encontrada.</p>
        ) : (
          options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={cn(
                'w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-purple-50',
                value === option.value && 'bg-purple-50 ring-1 ring-purple-200',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="font-medium text-gray-900">
                {formatPisCofinsTaxStatusOption(option)}
              </span>
            </button>
          ))
        )}
      </FiscalAnchoredDropdownPanel>
    </div>
  );
}
