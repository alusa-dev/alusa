import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listGlobalAdminUsers } from '@/features/global-admin/users/queries';
import { GlobalAdminEmptyState, GlobalAdminLinkTabs, GlobalAdminMetricCard, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperUsersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: 'ALL' | 'ACTIVE' | 'PENDING_ACCESS' | 'CANCELLED' };
}) {
  const data = await listGlobalAdminUsers({
    q: searchParams.q,
    status: searchParams.status,
    limit: 120,
  });
  const status = searchParams.status ?? 'ALL';
  const query = searchParams.q?.trim() ?? '';

  function buildStatusHref(nextStatus: 'ALL' | 'ACTIVE' | 'PENDING_ACCESS' | 'CANCELLED') {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (nextStatus !== 'ALL') params.set('status', nextStatus);
    const suffix = params.toString();
    return suffix ? `/developer/users?${suffix}` : '/developer/users';
  }

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Suporte diário"
        title="Usuários da Alusa"
        description="Localize qualquer pessoa rapidamente, veja o estado do acesso e abra o perfil de suporte da conta."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlobalAdminMetricCard
          label="Usuários encontrados"
          value={data.summary.total}
          description="Resultado atual com os filtros aplicados."
        />
        <GlobalAdminMetricCard
          label="Usuários ativos"
          value={data.summary.activeUsers}
          description="Pessoas com conta ativa no sistema."
          href="/developer/users?status=ACTIVE"
        />
        <GlobalAdminMetricCard
          label="Acessos pendentes"
          value={data.summary.pendingAccess}
          description="Usuários que ainda precisam confirmar o acesso."
          tone={data.summary.pendingAccess > 0 ? 'warning' : 'success'}
          href="/developer/users?status=PENDING_ACCESS"
        />
        <GlobalAdminMetricCard
          label="Usuários em contas canceladas"
          value={data.summary.cancelledAccounts}
          description="Usuários ligados a contas já canceladas."
          tone={data.summary.cancelledAccounts > 0 ? 'warning' : 'default'}
          href="/developer/users?status=CANCELLED"
        />
      </section>

      <GlobalAdminPanel title="Lista de usuários" description="Use a busca para nome, e-mail, telefone ou conta.">
        <div className="mb-5 flex flex-col gap-3">
          <GlobalAdminLinkTabs
            items={[
              { href: buildStatusHref('ALL'), label: 'Todos', active: status === 'ALL' },
              { href: buildStatusHref('ACTIVE'), label: 'Ativos', active: status === 'ACTIVE' },
              { href: buildStatusHref('PENDING_ACCESS'), label: 'Acesso pendente', active: status === 'PENDING_ACCESS' },
              { href: buildStatusHref('CANCELLED'), label: 'Conta cancelada', active: status === 'CANCELLED' },
            ]}
          />
          <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" method="GET">
            {status !== 'ALL' ? <input type="hidden" name="status" value={status} /> : null}
            <Input
              name="q"
              defaultValue={searchParams.q}
              placeholder="Buscar por nome, e-mail, telefone ou conta"
              className="h-10 rounded-lg border-slate-200 bg-white shadow-sm"
            />
            <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">
              Filtrar
            </Button>
          </form>
        </div>

        <div className="space-y-3">
          {data.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhum usuário encontrado"
              description="Ajuste os filtros ou tente um termo mais amplo para localizar a conta desejada."
            />
          ) : (
            data.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">{item.nome}</p>
                      <GlobalAdminSeverityBadge severity={item.contaStatus === 'CANCELADA' ? 'warning' : item.accessStatus === 'Confirmação pendente' ? 'warning' : 'success'}>
                        {item.accessStatus}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="text-sm text-slate-600">
                      {item.email}
                      {item.telefone ? ` • ${item.telefone}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.contaNome} • {item.role} • {item.financeStatus}
                    </p>
                  </div>

                  <div className="grid gap-1 text-sm text-slate-500 xl:text-right">
                    <span>{item.contaStatus === 'CANCELADA' ? 'Conta cancelada' : 'Conta ativa'}</span>
                    <span>Criado em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</span>
                    <span>Atualizado em {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </GlobalAdminPanel>
    </div>
  );
}
