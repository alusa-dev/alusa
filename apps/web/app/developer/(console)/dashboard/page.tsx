import Link from 'next/link';

import { getGlobalAdminDashboard } from '@/features/global-admin/dashboard/queries';
import { listGlobalAdminRequestLogs } from '@/features/global-admin/logs/queries';
import { GlobalAdminEmptyState, GlobalAdminMetricCard, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';
import { listGlobalAdminSupportCases } from '@/features/global-admin/support/queries';

export const dynamic = 'force-dynamic';

function getSupportContext(item: {
  contaNome: string | null;
  personName: string | null;
}) {
  if (item.personName && item.contaNome) return `${item.personName} • ${item.contaNome}`;
  if (item.personName) return item.personName;
  if (item.contaNome) return item.contaNome;
  return 'Sem contexto adicional';
}

function getSupportActionLabel(action: string) {
  if (action.toLowerCase().includes('acesso')) return 'Conferir acesso';
  if (action.toLowerCase().includes('webhook')) return 'Abrir webhooks';
  if (action.toLowerCase().includes('cobrança')) return 'Revisar cobrança';
  if (action.toLowerCase().includes('conta')) return 'Abrir conta';
  return action;
}

export default async function DeveloperDashboardPage() {
  const [dashboard, supportCases, requestErrors] = await Promise.all([
    getGlobalAdminDashboard(),
    listGlobalAdminSupportCases({ limit: 6 }),
    listGlobalAdminRequestLogs({ status: 'ERROR', limit: 5 }),
  ]);

  const quickActions = [
    {
      title: 'Acessos e login',
      count: dashboard.business.pendingAccessUsers,
      description: 'Conferir usuários com acesso pendente ou travado.',
      href: '/developer/users?status=PENDING_ACCESS',
    },
    {
      title: 'Cobranças e pagamentos',
      count: dashboard.summary.financialDivergences,
      description: 'Revisar cobrança não criada ou pagamento sem atualização.',
      href: '/developer/problems',
    },
    {
      title: 'Webhooks do Asaas',
      count: dashboard.summary.tenantsWithBadWebhook,
      description: 'Ver eventos com falha, rejeição ou desalinhamento.',
      href: '/developer/webhooks',
    },
    {
      title: 'Erros técnicos',
      count: dashboard.business.requestErrorsInWindow,
      description: 'Abrir falhas recentes de integração e sincronização.',
      href: '/developer/requests?status=ERROR',
    },
  ];

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        title="Visão geral da Alusa"
        description="Acompanhe o que precisa de ação hoje, localize contas com problema e veja sinais importantes da operação sem precisar abrir o banco ou o Asaas primeiro."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <GlobalAdminMetricCard
          label="Usuários ativos"
          value={dashboard.business.activeUsers}
          description="Usuários com conta ativa dentro da Alusa."
          href="/developer/users?status=ACTIVE"
        />
        <GlobalAdminMetricCard
          label="Contas ativas"
          value={dashboard.business.activeAccounts}
          description="Escolas e contas em operação neste momento."
          href="/developer/tenants"
        />
        <GlobalAdminMetricCard
          label="Acessos pendentes"
          value={dashboard.business.pendingAccessUsers}
          description="Usuários que ainda precisam concluir o acesso."
          href="/developer/users?status=PENDING_ACCESS"
        />
        <GlobalAdminMetricCard
          label="Contas canceladas"
          value={dashboard.business.cancelledAccounts}
          description="Contas que já saíram da Alusa e seguem no histórico."
          href="/developer/tenants"
        />
        <GlobalAdminMetricCard
          label="Cancelamentos recentes"
          value={dashboard.business.cancelledInWindow}
          description="Contas canceladas dentro da janela atual."
          href="/developer/dashboard#cancelamentos"
        />
        <GlobalAdminMetricCard
          label="Problemas abertos"
          value={supportCases.summary.total}
          description="Casos que merecem olhar do suporte."
          href="/developer/problems"
        />
        <GlobalAdminMetricCard
          label="Falhas de webhook"
          value={dashboard.summary.tenantsWithBadWebhook}
          description="Contas com webhook desalinhado ou com falha recente."
          href="/developer/webhooks"
        />
        <GlobalAdminMetricCard
          label="Pagamentos divergentes"
          value={dashboard.summary.financialDivergences}
          description="Pagamentos que não bateram com o estado local."
          href="/developer/problems"
        />
        <GlobalAdminMetricCard
          label="Erros de integração"
          value={dashboard.business.requestErrorsInWindow}
          description="Erros recentes ao falar com serviços externos."
          href="/developer/requests?status=ERROR"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-6">
          <GlobalAdminPanel title="Resolver rápido hoje" description="Atalhos diretos para os problemas mais comuns do suporte.">
            <div className="grid gap-3 md:grid-cols-2">
              {quickActions.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                      <p className="text-xs leading-5 text-slate-500">{item.description}</p>
                    </div>
                    <span className="text-[26px] font-semibold leading-none text-slate-950">{item.count}</span>
                  </div>
                </Link>
              ))}
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel
            title="O que precisa de atenção"
            description="Itens mais práticos para começar o atendimento."
            aside={
              <Link href="/developer/problems" className="text-sm font-medium text-brand-accent hover:underline">
                Ver tudo
              </Link>
            }
          >
            <div className="grid gap-3 xl:grid-cols-2">
            {supportCases.items.length === 0 ? (
              <GlobalAdminEmptyState
                title="Nenhum problema aberto agora"
                description="Quando surgir uma cobrança travada, erro de integração ou conta com acesso pendente, ela aparecerá aqui."
              />
            ) : (
              supportCases.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                        <GlobalAdminSeverityBadge severity={item.severity}>
                          {item.statusLabel}
                        </GlobalAdminSeverityBadge>
                      </div>
                      <p className="truncate text-xs text-slate-500">{getSupportContext(item)}</p>
                      <p className="line-clamp-2 text-sm leading-5 text-slate-600">{item.summary}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                        Próximo passo
                      </p>
                      <p className="mt-1 text-sm font-medium text-brand-accent">
                        {getSupportActionLabel(item.suggestedAction)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
            </div>
          </GlobalAdminPanel>
        </div>

        <div className="space-y-6">
          <GlobalAdminPanel
            title="Usuários novos"
            description="Entradas recentes para acompanhar onboarding e primeiro acesso."
            aside={
              <Link href="/developer/users" className="text-sm font-medium text-brand-accent hover:underline">
                Ver lista
              </Link>
            }
          >
            <div className="space-y-3">
              {dashboard.recentUsers.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem usuários novos"
                  description="Os novos cadastros aparecem aqui para facilitar o acompanhamento."
                />
              ) : (
                dashboard.recentUsers.map((user) => (
                  <Link
                    key={user.userId}
                    href={user.href}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div>
                      <p className="font-semibold text-slate-950">{user.nome}</p>
                      <p className="text-sm text-slate-500">{user.email}</p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{user.tenantName}</p>
                      <p>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel
            title="Cancelamentos recentes"
            description="Contas que saíram da Alusa na janela atual."
            className="scroll-mt-24"
          >
            <div id="cancelamentos" className="space-y-3">
              {dashboard.recentCancellations.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem cancelamentos no período"
                  description="Quando houver cancelamento, ele aparecerá aqui com a data e o motivo registrado."
                />
              ) : (
                dashboard.recentCancellations.map((item) => (
                  <Link
                    key={item.tenantId}
                    href={`/developer/tenants/${item.tenantId}`}
                    className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-950">{item.tenantName}</p>
                        <p className="text-sm text-slate-500">
                          {item.reason?.trim() || 'Sem motivo registrado'}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {new Date(item.cancelledAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </GlobalAdminPanel>
        </div>
      </div>

      <GlobalAdminPanel
        title="Erros recentes de integração"
        description="Falhas recentes em criação de cobrança, sincronização ou outras chamadas externas."
        aside={
          <Link href="/developer/requests?status=ERROR" className="text-sm font-medium text-brand-accent hover:underline">
            Ver requisições
          </Link>
        }
      >
        <div className="space-y-3">
          {requestErrors.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhum erro recente"
              description="Quando uma integração externa falhar, o detalhe aparece aqui para o suporte agir mais rápido."
            />
          ) : (
            requestErrors.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{item.tipoOperacao}</p>
                      <GlobalAdminSeverityBadge severity="critical">erro</GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.contaNome} • {item.entidade} {item.entidadeId}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {item.errorMessage ?? 'Sem mensagem de erro registrada.'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>{item.httpStatus ? `HTTP ${item.httpStatus}` : 'Sem HTTP'}</p>
                    <p>{new Date(item.createdAt).toLocaleString('pt-BR')}</p>
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
