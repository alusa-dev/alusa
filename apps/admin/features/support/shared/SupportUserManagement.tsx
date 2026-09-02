'use client';

import { useState } from 'react';
import type { AdminRole } from '@alusa/admin-auth';
import type { AdminUserRow } from '@/features/admin-users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const roles: AdminRole[] = ['READ_ONLY', 'SUPPORT', 'FINANCE_OPS', 'ENGINEERING', 'OWNER'];

async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(json?.error ?? 'Operação não concluída');
  return json;
}

export function SupportUserManagement({ users }: { users: AdminUserRow[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      await sendJson('/api/admin/support-users', 'POST', { username: form.get('username'), email: form.get('email') || null, password: form.get('password'), role: form.get('role') });
      event.currentTarget.reset(); setMessage('Identidade administrativa criada. Atualize a página para consultar a lista.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao criar identidade.'); }
    finally { setLoading(false); }
  }

  async function updateUser(id: string, payload: Record<string, unknown>) {
    setLoading(true); setMessage(null);
    try { await sendJson(`/api/admin/support-users/${id}`, 'PATCH', payload); setMessage('Identidade atualizada. Atualize a página para consultar a lista.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao atualizar identidade.'); }
    finally { setLoading(false); }
  }

  return <div className="space-y-6"><form className="grid gap-4 rounded-lg border border-slate-200 p-4 md:grid-cols-4" onSubmit={createUser}><div className="space-y-2"><Label htmlFor="admin-username">Usuário</Label><Input id="admin-username" name="username" required minLength={3} /></div><div className="space-y-2"><Label htmlFor="admin-email">E-mail</Label><Input id="admin-email" name="email" type="email" /></div><div className="space-y-2"><Label htmlFor="admin-password">Senha</Label><Input id="admin-password" name="password" type="password" required minLength={10} /></div><div className="space-y-2"><Label htmlFor="admin-role">Papel</Label><select id="admin-role" name="role" className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" defaultValue="SUPPORT">{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></div><div className="md:col-span-4"><Button type="submit" disabled={loading}>Criar identidade</Button></div></form>{message ? <p className="text-sm text-slate-600" role="status">{message}</p> : null}<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th className="py-3 pr-4">Usuário</th><th className="py-3 pr-4">Papel</th><th className="py-3 pr-4">Status</th><th className="py-3 pr-4">Elevações ativas</th><th className="py-3 pr-4">Último acesso</th><th className="py-3 pr-4">Ações</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={user.id}><td className="py-3 pr-4"><p className="font-medium text-slate-950">{user.username}</p><p className="mt-1 text-xs text-slate-500">{user.email ?? 'Sem e-mail'}</p></td><td className="py-3 pr-4"><select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={user.role} onChange={(event) => updateUser(user.id, { role: event.target.value })} disabled={loading}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></td><td className="py-3 pr-4">{user.status}</td><td className="py-3 pr-4">{user.elevationCount}</td><td className="py-3 pr-4">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : 'Nunca'}</td><td className="py-3 pr-4"><Button type="button" variant="outline" disabled={loading} onClick={() => updateUser(user.id, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>{user.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}</Button></td></tr>)}</tbody></table></div></div>;
}
