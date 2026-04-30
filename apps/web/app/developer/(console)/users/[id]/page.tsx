import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { GlobalAdminActionCenter } from '@/features/global-admin/shared/GlobalAdminActionCenter';
import { GlobalAdminEmptyState, GlobalAdminMetricCard, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';
import { getGlobalAdminUserSupportProfile } from '@/features/global-admin/users/queries';

export const dynamic = 'force-dynamic';

export default async function DeveloperUserSupportPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getGlobalAdminUserSupportProfile(params.id);

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Perfil de suporte"
        title={data.user.nome}
        description={`Conta ${data.user.contaNome}. Use esta visão para tratar acesso, cobrança, webhooks e histórico recente sem sair da página.`}
        actions={
          <Link href={`/developer/tenants/${data.user.contaId}`}>
            <Button variant="outline" className="h-10 rounded-lg border-slate-200 px-4 text-slate-700 hover:bg-slate-50">
              Abrir conta
            </Button>
          </Link>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlobalAdminMetricCard
          label="Status do acesso"
          value={data.support.accessStatus}
          description="Situação atual para entrar no sistema."
          tone={data.user.emailVerifiedAt ? 'success' : 'warning'}
        />
        <GlobalAdminMetricCard
          label="Pedidos de nova senha"
          value={data.support.passwordResetOpenRequests}
          description="Links de redefinição ainda válidos."
          tone={data.support.passwordResetOpenRequests > 0 ? 'warning' : 'default'}
        />
        <GlobalAdminMetricCard
          label="Cobranças em aberto"
          value={data.support.openCharges}
          description="Cobranças do usuário ainda sem fechamento."
          href={`/developer/search?q=${data.user.id}`}
        />
        <GlobalAdminMetricCard
          label="Diferenças de pagamento"
          value={data.support.divergentCharges}
          description="Pagamentos que podem precisar de sincronização."
          tone={data.support.divergentCharges > 0 ? 'warning' : 'success'}
          href={`/developer/tenants/${data.user.contaId}`}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-6">
          <GlobalAdminPanel title="Resumo do usuário" description="Informações básicas para atendimento rápido.">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoBlock label="E-mail" value={data.user.email} />
              <InfoBlock label="Telefone" value={data.user.telefone ?? 'Não informado'} />
              <InfoBlock label="Perfil" value={data.user.role} />
              <InfoBlock label="Conta" value={data.user.contaNome} />
              <InfoBlock
                label="Primeiro acesso"
                value={data.user.emailVerifiedAt ? 'Liberado' : 'Pendente'}
              />
              <InfoBlock
                label="Último pedido de nova senha"
                value={
                  data.support.lastPasswordResetAt
                    ? new Date(data.support.lastPasswordResetAt).toLocaleString('pt-BR')
                    : 'Sem pedido recente'
                }
              />
            </div>
            {data.user.accountDeletedAt ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Conta cancelada em {new Date(data.user.accountDeletedAt).toLocaleDateString('pt-BR')}.
                {data.user.accountDeleteReason ? ` Motivo: ${data.user.accountDeleteReason}.` : ''}
              </div>
            ) : null}
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Cobranças recentes" description="Últimas cobranças ligadas ao usuário.">
            <div className="space-y-3">
              {data.recentCharges.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem cobranças recentes"
                  description="Quando houver cobrança vinculada a este usuário, ela aparecerá aqui."
                />
              ) : (
                data.recentCharges.map((charge) => (
                  <Link
                    key={charge.id}
                    href={charge.href}
                    className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-semibold text-slate-950">
                          {charge.descricao ?? 'Cobrança sem descrição'}
                        </p>
                        <p className="text-sm text-slate-500">
                          Local: {charge.status} • Asaas: {charge.asaasStatus ?? 'Sem status remoto'}
                        </p>
                      </div>
                      <div className="text-sm text-slate-500 lg:text-right">
                        <p>{charge.valor != null ? `R$ ${charge.valor.toFixed(2)}` : 'Sem valor'}</p>
                        <p>Vence em {new Date(charge.vencimento).toLocaleDateString('pt-BR')}</p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Requisições recentes" description="Chamadas externas mais novas desta conta.">
            <SimpleRequestList items={data.recentRequestLogs} emptyTitle="Sem requisições recentes" />
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Webhooks recentes" description="Eventos recebidos para esta conta.">
            <SimpleWebhookList items={data.recentWebhookLogs} emptyTitle="Sem webhooks recentes" />
          </GlobalAdminPanel>
        </div>

        <div className="space-y-6">
          <GlobalAdminActionCenter compact initialTenantId={data.user.contaId} />

          <GlobalAdminPanel title="Erros ligados a esta conta" description="Falhas recentes para orientar o suporte.">
            <div className="space-y-3">
              {data.recentErrors.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem erros recentes"
                  description="Nenhuma falha relevante apareceu recentemente para esta conta."
                />
              ) : (
                data.recentErrors.map((item) => (
                  <Link
                    key={`${item.kind}-${item.id}`}
                    href={item.href ?? '/developer/errors'}
                    className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-950">{item.title}</p>
                          <GlobalAdminSeverityBadge severity={item.severity}>
                            {item.kind.toLowerCase()}
                          </GlobalAdminSeverityBadge>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{item.summary}</p>
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Histórico de ações" description="Últimas ações feitas na conta.">
            <div className="space-y-3">
              {data.auditPreview.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem histórico recente"
                  description="As ações administrativas aparecerão aqui conforme forem executadas."
                />
              ) : (
                data.auditPreview.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{item.action}</p>
                      <GlobalAdminSeverityBadge severity={item.status === 'ERROR' ? 'warning' : 'success'}>
                        {item.status === 'ERROR' ? 'com falha' : 'concluída'}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.reason ?? 'Sem motivo informado'}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.actorIdentifier} • {new Date(item.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                ))
              )}
            </div>
          </GlobalAdminPanel>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SimpleRequestList({
  items,
  emptyTitle,
}: {
  items: Awaited<ReturnType<typeof getGlobalAdminUserSupportProfile>>['recentRequestLogs'];
  emptyTitle: string;
}) {
  if (items.length === 0) {
    return (
      <GlobalAdminEmptyState
        title={emptyTitle}
        description="Quando houver chamadas importantes de integração, elas aparecem aqui."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-slate-950">{item.tipoOperacao}</p>
              <p className="text-sm text-slate-500">
                {item.entidade} • {item.status === 'ERROR' ? 'com erro' : 'ok'}
              </p>
            </div>
            <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('pt-BR')}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function SimpleWebhookList({
  items,
  emptyTitle,
}: {
  items: Awaited<ReturnType<typeof getGlobalAdminUserSupportProfile>>['recentWebhookLogs'];
  emptyTitle: string;
}) {
  if (items.length === 0) {
    return (
      <GlobalAdminEmptyState
        title={emptyTitle}
        description="Quando chegar evento do Asaas para esta conta, ele aparece aqui."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href ?? '/developer/webhooks'}
          className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-white"
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-slate-950">{item.evento ?? 'Evento sem nome'}</p>
                <GlobalAdminSeverityBadge severity={item.status === 'REJEITADO' ? 'critical' : item.status === 'ERRO' || item.status === 'EXAURIDO' ? 'warning' : 'success'}>
                  {item.status}
                </GlobalAdminSeverityBadge>
              </div>
              <p className="text-sm text-slate-500">{item.source === 'REJECTION' ? 'Evento rejeitado' : 'Evento registrado'}</p>
            </div>
            <p className="text-xs text-slate-500">{new Date(item.receivedAt).toLocaleString('pt-BR')}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
