'use client';

import { useState } from 'react';
import type { SupportRole, SupportUserStatus } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SupportUserRow = {
  id: string;
  username: string;
  email: string | null;
  role: SupportRole;
  status: SupportUserStatus;
  breakGlassExpiresAt: Date | string | null;
  lastLoginAt: Date | string | null;
};

const roles: SupportRole[] = [
  'SUPPORT_VIEWER',
  'SUPPORT_AGENT',
  'SUPPORT_FINANCE',
  'SUPPORT_DEVELOPER',
  'SUPPORT_ADMIN',
  'BREAK_GLASS',
];

async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? 'Operação não concluída');
  return json;
}

export function SupportUserManagement({ users }: { users: SupportUserRow[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      await sendJson('/api/developer/support-users', 'POST', {
        username: form.get('username'),
        email: form.get('email') || null,
        password: form.get('password'),
        role: form.get('role'),
        breakGlassExpiresAt: form.get('breakGlassExpiresAt') || null,
      });
      event.currentTarget.reset();
      setMessage('Usuário interno criado. Atualize a página para ver a lista mais recente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao criar usuário.');
    } finally {
      setLoading(false);
    }
  }

  async function updateUser(id: string, payload: Record<string, unknown>) {
    setLoading(true);
    setMessage(null);
    try {
      await sendJson(`/api/developer/support-users/${id}`, 'PATCH', payload);
      setMessage('Usuário atualizado. Atualize a página para ver a lista mais recente.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao atualizar usuário.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-5" onSubmit={createUser}>
        <div className="space-y-2">
          <Label htmlFor="support-username">Usuário</Label>
          <Input id="support-username" name="username" required minLength={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-email">E-mail</Label>
          <Input id="support-email" name="email" type="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-password">Senha</Label>
          <Input id="support-password" name="password" type="password" required minLength={10} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-role">Papel</Label>
          <select
            id="support-role"
            name="role"
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            defaultValue="SUPPORT_AGENT"
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-break-glass">Break-glass até</Label>
          <Input id="support-break-glass" name="breakGlassExpiresAt" type="datetime-local" />
        </div>
        <div className="md:col-span-5">
          <Button type="submit" disabled={loading}>
            Criar usuário interno
          </Button>
        </div>
      </form>

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-3 pr-4">Usuário</th>
              <th className="py-3 pr-4">Papel</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Break-glass</th>
              <th className="py-3 pr-4">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="py-3 pr-4">
                  <p className="font-medium text-slate-950">{user.username}</p>
                  <p className="mt-1 text-xs text-slate-500">{user.email ?? 'Sem e-mail'}</p>
                </td>
                <td className="py-3 pr-4">
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                    defaultValue={user.role}
                    onChange={(event) => updateUser(user.id, { role: event.target.value })}
                    disabled={loading}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-3 pr-4">{user.status}</td>
                <td className="py-3 pr-4">
                  {user.breakGlassExpiresAt ? new Date(user.breakGlassExpiresAt).toLocaleString('pt-BR') : 'N/A'}
                </td>
                <td className="py-3 pr-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() =>
                      updateUser(user.id, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })
                    }
                  >
                    {user.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
