'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatNbsCode } from '@alusa/finance/fiscal-wizard-client';

import { FiscalAnchoredDropdownPanel } from './FiscalAnchoredDropdownPanel';
import { useFiscalDropdownControl } from './FiscalDropdownScope';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FiscalFieldError,
  FiscalFieldLabel,
  fiscalInputClass,
} from './FiscalWizardFields';

type NbsOption = { nbsCode?: string; codeDescription?: string };

type FiscalNbsCodeFieldProps = {
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onSearch: (query?: string) => Promise<{ data: NbsOption[] }>;
};

const SEARCH_DEBOUNCE_MS = 400;

export function FiscalNbsCodeField({ value, error, onChange, onSearch }: FiscalNbsCodeFieldProps) {
  const dropdownId = useId();
  const { open, setOpen } = useFiscalDropdownControl(dropdownId);
  const [options, setOptions] = useState<NbsOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(value.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onSearch(debouncedQuery || undefined)
      .then((result) => {
        if (!cancelled) setOptions(result.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, onSearch]);

  return (
    <div className={FISCAL_WIZARD_FIELD_CLASS}>
      <FiscalFieldLabel
        label="NBS"
        help="Nomenclatura Brasileira de Serviços — formato 1.0000.00.00. Busque por descrição ou digite os 9 dígitos."
      />
      <div ref={anchorRef}>
        <Input
          value={value}
          placeholder="1.2201.11.00"
          inputMode="numeric"
          className={fiscalInputClass(Boolean(error))}
          onFocus={() => setOpen(true)}
          onChange={(event) => onChange(formatNbsCode(event.target.value))}
        />
      </div>
      <FiscalFieldError message={error} />
      <FiscalAnchoredDropdownPanel
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
      >
        {loading ? (
          <p className="px-2 py-2 text-xs text-gray-500">Buscando códigos NBS…</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-gray-500">
            Nenhum código encontrado. Digite os 9 dígitos no formato 1.0000.00.00.
          </p>
        ) : (
          options.map((option) => (
            <button
              key={option.nbsCode ?? option.codeDescription}
              type="button"
              role="option"
              aria-selected={value === option.nbsCode}
              className={cn(
                'w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-purple-50',
                value === option.nbsCode && 'bg-purple-50 ring-1 ring-purple-200',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (option.nbsCode) onChange(option.nbsCode);
                setOpen(false);
              }}
            >
              <span className="font-medium text-gray-900">
                {option.codeDescription ?? option.nbsCode}
              </span>
            </button>
          ))
        )}
      </FiscalAnchoredDropdownPanel>
    </div>
  );
}
