'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const values = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: values.get('username'), password: values.get('password') }) });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Não foi possível autenticar.');
      setPending(false);
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  return <form onSubmit={submit}>
    <div className="field"><label htmlFor="username">Usuário ou e-mail</label><input id="username" name="username" autoComplete="username" required /></div>
    <div className="field"><label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending} type="submit">{pending ? 'Entrando...' : 'Entrar'}</button>
  </form>;
}
