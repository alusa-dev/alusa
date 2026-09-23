'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { FormEvent } from 'react';
import { formatCpfCnpjBR, formatPhoneBR, onlyDigits } from '@/lib/formatters';
import { toast } from '@/components/ui/toast';

export default function AcceptInviteButton({ token, requireGuardianData = false }: { token: string; requireGuardianData?: boolean }) {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');

  async function accept(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/users/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(requireGuardianData ? { cpf: onlyDigits(cpf), telefone: onlyDigits(telefone) } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && body.code === 'USER_ALREADY_LINKED') {
        toast.warning('Conta já vinculada', {
          description: body.error ?? 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
        });
        setPending(false);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? 'Não foi possível aceitar o convite.');
      if (body.user?.contaId) await updateSession({ contaId: body.user.contaId });
      router.replace('/dashboard');
      window.location.assign('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível aceitar o convite.');
      setPending(false);
    }
  }

  return (
    <form className="mt-6 space-y-3" onSubmit={(event) => void accept(event)}>
      {requireGuardianData ? (
        <>
          <label className="block text-left text-sm font-medium">
            CPF
            <input data-testid="invite-guardian-cpf" autoComplete="off" inputMode="numeric" maxLength={14} required
              value={cpf} onChange={(event) => setCpf(formatCpfCnpjBR(onlyDigits(event.currentTarget.value).slice(0, 11)))}
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3" placeholder="000.000.000-00" />
          </label>
          <label className="block text-left text-sm font-medium">
            Telefone com DDD
            <input data-testid="invite-guardian-phone" type="tel" autoComplete="tel" inputMode="tel" maxLength={15} required
              value={telefone} onChange={(event) => setTelefone(formatPhoneBR(event.currentTarget.value))}
              className="mt-1 h-11 w-full rounded-lg border border-input bg-background px-3" placeholder="(00) 00000-0000" />
          </label>
        </>
      ) : null}
      <button type={requireGuardianData ? 'submit' : 'button'} onClick={requireGuardianData ? undefined : () => void accept()} disabled={pending}
        className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-60">
        {pending ? 'Aceitando convite…' : 'Aceitar convite'}
      </button>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
