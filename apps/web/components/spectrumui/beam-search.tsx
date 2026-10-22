'use client';

import * as React from 'react';
import { BorderBeam, type BorderBeamColorVariant } from 'border-beam';

import { Search, X } from '@/components/icons/icons';
import { cn } from '@/lib/utils';
import { useSurfaceTheme, type SurfaceTheme } from '@/components/spectrumui/use-surface-theme';

export interface BeamSearchProps {
  value?: string;
  defaultValue?: string;
  onChange?: (_value: string) => void;
  /** Fires on Enter with the current value */
  onSubmit?: (_value: string) => void;
  placeholder?: string;
  /** Keep the beam running even without focus. Default false */
  alwaysOn?: boolean;
  /** Palette: "colorful" | "ocean" | "sunset" | "mono". Default "colorful" */
  colorVariant?: BorderBeamColorVariant;
  /** "auto" follows a `.dark`/`.light` class on <html>, then the OS. Default "auto" */
  theme?: SurfaceTheme;
  /** Right-hand slot, e.g. a keyboard hint */
  trailing?: React.ReactNode;
  className?: string;
  /** Forward a ref and native input attributes to the search field. */
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  clearLabel?: string;
  clearOnEscape?: boolean;
  shape?: 'rounded' | 'pill';
}

export function BeamSearch({
  value,
  defaultValue = '',
  onChange,
  onSubmit,
  placeholder = 'Search…',
  alwaysOn = false,
  colorVariant = 'colorful',
  theme = 'auto',
  trailing,
  className,
  inputRef: forwardedInputRef,
  inputProps,
  clearLabel = 'Clear',
  clearOnEscape = true,
  shape = 'rounded',
}: BeamSearchProps) {
  const resolved = useSurfaceTheme(theme);
  const [inner, setInner] = React.useState(defaultValue);
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const current = value ?? inner;

  const assignInputRef = React.useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedInputRef === 'function') {
      forwardedInputRef(node);
    } else if (forwardedInputRef) {
      Object.assign(forwardedInputRef, { current: node });
    }
  }, [forwardedInputRef]);

  const update = (next: string) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  return (
    <BorderBeam
      size="line"
      colorVariant={colorVariant}
      theme={resolved}
      active={alwaysOn || focused}
      borderRadius={shape === 'pill' ? 24 : undefined}
      className={cn('w-full', className)}
    >
      <label
        className={cn(
          'flex h-12 w-full items-center gap-3 border border-black/10 bg-white px-3.5 transition-colors alusa-dark:border-white/12 alusa-dark:bg-neutral-950',
          shape === 'pill' ? 'rounded-full' : 'rounded-xl',
          focused && 'border-black/20 alusa-dark:border-white/20',
        )}
      >
        <Search className="size-4 shrink-0 text-neutral-400" aria-hidden />
        <input
          {...inputProps}
          ref={assignInputRef}
          type={inputProps?.type ?? 'search'}
          value={current}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
          onFocus={(event) => {
            setFocused(true);
            inputProps?.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            inputProps?.onBlur?.(event);
          }}
          onKeyDown={(event) => {
            inputProps?.onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Enter') onSubmit?.(current);
            if (event.key === 'Escape' && clearOnEscape) update('');
          }}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 alusa-dark:text-neutral-100 alusa-dark:placeholder:text-neutral-500 [&::-webkit-search-cancel-button]:hidden',
            inputProps?.className,
          )}
        />
        {current ? (
          <button
            type="button"
            aria-label={clearLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              update('');
              inputRef.current?.focus();
            }}
            className="flex size-6 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-black/5 hover:text-neutral-700 alusa-dark:hover:bg-white/8 alusa-dark:hover:text-neutral-200"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          trailing
        )}
      </label>
    </BorderBeam>
  );
}
