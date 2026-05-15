'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function DeveloperLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl =
    searchParams.get('callbackUrl')?.startsWith('/developer') &&
    searchParams.get('callbackUrl') !== '/developer/login'
      ? (searchParams.get('callbackUrl') as string)
      : '/developer';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/global-admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !json?.success) {
        throw new Error(json?.error ?? 'Falha ao autenticar');
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.16),_transparent_35%),linear-gradient(180deg,_#eef2ff_0%,_#f8fafc_100%)] px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 bg-white/95 shadow-[0_30px_80px_rgba(15,23,42,0.16)]">
        <CardHeader className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Alusa</p>
            <CardTitle className="mt-2 text-3xl tracking-tight text-slate-950">
              Entrar na central
            </CardTitle>
          </div>
          <CardDescription>
            Acesso separado do login do produto. Use a credencial restrita da central de suporte da
            Alusa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : null}
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? 'Autenticando...' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
