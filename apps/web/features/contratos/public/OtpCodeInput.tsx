'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type OtpCodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function OtpCodeInput({ value, onChange: handleChange, disabled = false, autoFocus = false }: OtpCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const focusAt = (index: number) => {
    inputRefs.current[Math.max(0, Math.min(index, 5))]?.focus();
  };

  const updateFromText = (index: number, rawValue: string) => {
    const nextDigits = value.padEnd(6, ' ').slice(0, 6).split('');
    const onlyDigits = rawValue.replace(/\D/g, '');
    if (!onlyDigits) {
      nextDigits[index] = ' ';
      handleChange(nextDigits.join('').replace(/\s/g, ''));
      return;
    }

    onlyDigits.slice(0, 6 - index).split('').forEach((digit, offset) => {
      nextDigits[index + offset] = digit;
    });
    handleChange(nextDigits.join('').replace(/\s/g, ''));
    focusAt(Math.min(index + onlyDigits.length, 5));
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-labelledby="public-otp-label">
      {digits.map((digit, index) => (
        <Input
          key={`otp-${index}`}
          ref={(element) => { inputRefs.current[index] = element; }}
          aria-label={`Dígito ${index + 1} de 6`}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          inputMode="numeric"
          maxLength={1}
          value={digit.trim()}
          onChange={(event) => updateFromText(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index].trim() && index > 0) {
              event.preventDefault();
              const nextDigits = value.padEnd(6, ' ').slice(0, 6).split('');
              nextDigits[index - 1] = ' ';
              handleChange(nextDigits.join('').replace(/\s/g, ''));
              focusAt(index - 1);
            }
            if (event.key === 'ArrowLeft') focusAt(index - 1);
            if (event.key === 'ArrowRight') focusAt(index + 1);
          }}
          onPaste={(event) => {
            event.preventDefault();
            updateFromText(index, event.clipboardData.getData('text'));
          }}
          className={cn(
            'h-12 w-11 rounded-xl border-slate-200 bg-white text-center text-lg font-bold tracking-wide shadow-sm focus-visible:border-brand-accent focus-visible:ring-brand-accent/25 sm:h-14 sm:w-12',
          )}
        />
      ))}
    </div>
  );
}
