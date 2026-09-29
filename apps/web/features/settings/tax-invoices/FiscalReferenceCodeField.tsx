'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { FiscalAnchoredDropdownPanel } from './FiscalAnchoredDropdownPanel';
import { useFiscalDropdownControl } from './FiscalDropdownScope';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FiscalFieldError,
  FiscalFieldLabel,
  fiscalInputClass,
} from './FiscalWizardFields';

export type FiscalReferenceCodeOption = { code?: string; description?: string };

type FiscalReferenceCodeFieldProps = {
  value: string;
  error?: string;
  label: string;
  help?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onSearch: (query?: string) => Promise<{ data: FiscalReferenceCodeOption[] }>;
};

const SEARCH_DEBOUNCE_MS = 400;

export function FiscalReferenceCodeField({
  value,
  error,
  label,
  help,
  placeholder,
  onChange,
  onSearch,
}: FiscalReferenceCodeFieldProps) {
  const dropdownId = useId();
  const { open, setOpen } = useFiscalDropdownControl(dropdownId);
  const [options, setOptions] = useState<FiscalReferenceCodeOption[]>([]);
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
      <FiscalFieldLabel label={label} help={help} />
      <div ref={anchorRef}>
        <Input
          value={value}
          placeholder={placeholder}
          className={fiscalInputClass(Boolean(error))}
          onFocus={() => setOpen(true)}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <FiscalFieldError message={error} />
      <FiscalAnchoredDropdownPanel
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
      >
        {loading ? (
          <p className="px-2 py-2 text-xs text-gray-500">Buscando códigos…</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-gray-500">
            Nenhum código encontrado. Digite o código ou busque por descrição.
          </p>
        ) : (
          options.map((option) => (
            <button
              key={`${option.code}-${option.description}`}
              type="button"
              role="option"
              aria-selected={value === option.code}
              className={cn(
                'w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-purple-50',
                value === option.code && 'bg-purple-50 ring-1 ring-purple-200',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (option.code) onChange(option.code);
                setOpen(false);
              }}
            >
              {option.code ? (
                <span className="font-medium text-gray-900">{option.code}</span>
              ) : null}
              {option.description ? (
                <span className={cn('text-gray-600', option.code && 'ml-1.5')}>
                  {option.description}
                </span>
              ) : null}
            </button>
          ))
        )}
      </FiscalAnchoredDropdownPanel>
    </div>
  );
}
