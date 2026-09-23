'use client';

import { isPasswordPolicyValid, passwordMinLength, passwordPolicyMessage } from '@/lib/password-policy';

type PasswordStrength = {
  label: string;
  tone: string;
  text: string;
};

function evaluatePasswordStrength(password: string): { score: number; strength: PasswordStrength } {
  const requirements = [
    password.length >= passwordMinLength,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[!@#$%^&*]/.test(password),
  ];
  const score = requirements.filter(Boolean).length;

  const strength = score <= 1
    ? { label: 'Muito fraca', tone: 'bg-red-500', text: 'text-red-600' }
    : score === 2
      ? { label: 'Fraca', tone: 'bg-red-500', text: 'text-red-600' }
      : score === 3
        ? { label: 'Média', tone: 'bg-amber-400', text: 'text-amber-600' }
        : score === 4
          ? { label: 'Forte', tone: 'bg-emerald-500', text: 'text-emerald-600' }
          : { label: 'Muito forte', tone: 'bg-emerald-500', text: 'text-emerald-600' };

  return { score, strength };
}

interface PasswordStrengthIndicatorProps {
  password: string;
  placement: 'field' | 'meter';
}

/** Shared password feedback for registration and invitation acceptance forms. */
export default function PasswordStrengthIndicator({ password, placement }: PasswordStrengthIndicatorProps) {
  if (!password) return null;

  const { score, strength } = evaluatePasswordStrength(password);

  if (placement === 'field') {
    return (
      <span
        className={`pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium ${strength.text}`}
        role="status"
        aria-live="polite"
        data-testid="register-password-strength-label"
      >
        {strength.label}
      </span>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Avaliação de segurança da senha"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={score}
      >
        <span
          aria-hidden="true"
          className={`block h-full rounded-full transition-[width,background-color] duration-300 ${strength.tone}`}
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <p className="text-xs leading-4 text-slate-500" aria-live="polite">
        {isPasswordPolicyValid(password)
          ? 'Sua senha atende aos requisitos de segurança.'
          : passwordPolicyMessage}
      </p>
    </div>
  );
}
