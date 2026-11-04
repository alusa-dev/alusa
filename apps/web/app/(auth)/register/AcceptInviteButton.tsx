'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { FormEvent } from 'react';
import { toast } from '@/components/ui/toast';

export default function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function accept(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/users/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 202 && body.verificationRequired) {
        setNotice(body.verificationEmailSent
          ? 'Confirme seu e-mail pelo link enviado. O convite continuará pendente até a confirmação.'
          : 'Não foi possível enviar a confirmação. Tente novamente para reenviar.');
        setPending(false);
        return;
      }
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
      <button type="submit" disabled={pending}
        className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-60">
        {pending ? 'Aceitando convite…' : 'Aceitar convite'}
      </button>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p> : null}
    </form>
  );
}
