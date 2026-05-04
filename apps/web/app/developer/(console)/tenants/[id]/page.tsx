import Link from 'next/link';

import { GlobalAdminActionCenter } from '@/features/global-admin/shared/GlobalAdminActionCenter';
import { GlobalAdminLiveRefresh } from '@/features/global-admin/shared/GlobalAdminLiveRefresh';
import { GlobalAdminEmptyState, GlobalAdminMetricCard, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';
import { getGlobalAdminTenant360 } from '@/features/global-admin/tenants/queries';

export const dynamic = 'force-dynamic';

export default async function DeveloperTenantPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focusCharge?: string; focusEvent?: string; focusMatricula?: string };
}) {
  const data = await getGlobalAdminTenant360(params.id);

  return (
    <div className="space-y-6">
      <GlobalAdminLiveRefresh intervalMs={60_000} />

      <GlobalAdminPageIntro
        eyebrow="Conta 360"
        title={data.tenant.nome}
        description={`Conta ${data.tenant.id}. Aqui você acompanha saúde financeira, webhooks, fila e histórico recente em uma única visão.`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlobalAdminMetricCard
          label="Conta financeira"
          value={data.financial.asaasAccountId ?? 'Não conectada'}
          description="Identificação da subconta no Asaas."
        />
        <GlobalAdminMetricCard
          label="Webhook"
          value={data.webhook.status}
          description="Situação atual do recebimento de eventos."
          tone={data.webhook.status === 'ERROR' ? 'critical' : data.webhook.status === 'WARNING' ? 'warning' : 'success'}
        />
        <GlobalAdminMetricCard
          label="Pendências na fila"
          value={data.queue.backlog}
          description="Eventos ainda pendentes ou com falha para esta conta."
          tone={data.queue.backlog > 0 ? 'warning' : 'success'}
        />
        <GlobalAdminMetricCard
          label="Cobranças com diferença"
          value={data.divergentCharges.count}
          description="Cobranças que podem precisar de sincronização."
          tone={data.divergentCharges.count > 0 ? 'warning' : 'success'}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-6">
          <GlobalAdminPanel title="Saúde da conta" description="Pontos que o suporte precisa conferir antes de agir.">
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Status financeiro: {data.tenant.financeStatus} • onboarding financeiro:{' '}
                {data.financial.onboardingStatus ?? 'não informado'}
              </p>
              <p className="text-sm text-slate-700">
                Credenciais da subconta: {data.financial.hasSubaccountCredentials ? 'ok' : 'ausentes'} • webhook remoto:{' '}
                {data.webhook.hasRemoteWebhook ? 'encontrado' : 'não encontrado'}
              </p>
              <div className="space-y-2">
                {data.webhook.recommendations.map((recommendation) => (
                  <div key={recommendation.code} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-950">{recommendation.code}</p>
                      <GlobalAdminSeverityBadge severity={recommendation.severity}>
                        {recommendation.severity === 'critical' ? 'alta' : recommendation.severity === 'warning' ? 'média' : 'info'}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-2 text-slate-600">{recommendation.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Últimos eventos" description="Eventos recentes recebidos para esta conta.">
            <div className="space-y-3">
              {data.latestEvents.map((event) => (
                <div
                  key={event.id}
                  className={`rounded-xl border px-4 py-3 ${
                    searchParams.focusEvent === event.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-950">{event.evento}</p>
                    <GlobalAdminSeverityBadge severity={event.status === 'ERRO' || event.status === 'EXAURIDO' ? 'warning' : 'success'}>
                      {event.status}
                    </GlobalAdminSeverityBadge>
                  </div>
                  <p className="text-sm text-slate-600">
                    EventId: {event.eventId ?? '-'} • tentativas: {event.tentativas}
                  </p>
                  <p className="text-xs text-slate-500">
                    Recebido em {new Date(event.recebidoEm).toLocaleString('pt-BR')}
                    {event.ultimoErro ? ` • erro: ${event.ultimoErro}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </GlobalAdminPanel>

          <GlobalAdminPanel title="Cobranças com diferença" description="Casos em que o sistema e o pagamento remoto não batem.">
            <div className="space-y-3">
              {data.divergentCharges.items.length === 0 ? (
                <GlobalAdminEmptyState
                  title="Sem divergências nesta conta"
                  description="Quando houver pagamento sem atualizar o estado local, ele aparece aqui."
                />
              ) : (
                data.divergentCharges.items.map((charge) => (
                  <div
                    key={charge.id}
                    className={`rounded-xl border px-4 py-3 ${
                      searchParams.focusCharge === charge.id ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <p className="font-medium text-slate-950">{charge.alunoNome}</p>
                    <p className="text-sm text-slate-600">
                      {charge.descricao ?? 'Sem descrição'} • local: {charge.status} • Asaas:{' '}
                      {charge.asaasStatus ?? 'n/a'}
                    </p>
                    <p className="text-xs text-slate-500">
                      paymentId: {charge.asaasPaymentId ?? '-'} • atualizado em{' '}
                      {new Date(charge.updatedAt).toLocaleString('pt-BR')}
                    </p>
                    {charge.asaasPaymentId ? (
                      <Link
                        href={`/developer/actions?tenantId=${params.id}&asaasPaymentId=${charge.asaasPaymentId}`}
                        className="mt-2 inline-flex text-xs font-medium text-brand-accent"
                      >
                        Abrir sincronização da cobrança
                      </Link>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </GlobalAdminPanel>
        </div>

        <div className="space-y-6">
          <GlobalAdminActionCenter compact initialTenantId={params.id} />

          <GlobalAdminPanel title="Histórico de ações" description="Últimas ações registradas nesta conta.">
            <div className="space-y-3">
              {data.auditPreview.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-950">{entry.action}</p>
                    <GlobalAdminSeverityBadge severity={entry.status === 'ERROR' ? 'warning' : 'success'}>
                      {entry.status === 'ERROR' ? 'com falha' : 'concluída'}
                    </GlobalAdminSeverityBadge>
                  </div>
                  <p className="text-sm text-slate-600">
                    {entry.actorIdentifier}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.reason ? `${entry.reason} • ` : ''}
                    {new Date(entry.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))}
            </div>
          </GlobalAdminPanel>
        </div>
      </div>
    </div>
  );
}
