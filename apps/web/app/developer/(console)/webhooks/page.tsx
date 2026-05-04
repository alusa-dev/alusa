import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listGlobalAdminWebhookLogs } from '@/features/global-admin/logs/queries';
import { GlobalAdminLiveRefresh } from '@/features/global-admin/shared/GlobalAdminLiveRefresh';
import { GlobalAdminEmptyState, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperWebhooksPage({
  searchParams,
}: {
  searchParams: { q?: string; contaId?: string; status?: string };
}) {
  const data = await listGlobalAdminWebhookLogs({
    q: searchParams.q,
    contaId: searchParams.contaId,
    status: searchParams.status,
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <GlobalAdminLiveRefresh intervalMs={45_000} />

      <GlobalAdminPageIntro
        eyebrow="Asaas"
        title="Logs de webhooks"
        description="Acompanhe o recebimento dos eventos do Asaas, veja rejeições e entenda rapidamente o que já foi processado ou ficou com falha."
      />

      <GlobalAdminPanel title="Filtros" description="Busque por conta, evento, paymentId ou eventId.">
        <form className="grid gap-3 md:grid-cols-[2fr,1fr,1fr,auto]" method="GET">
          <Input name="q" defaultValue={searchParams.q} placeholder="Buscar por evento, paymentId ou eventId" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Input name="contaId" defaultValue={searchParams.contaId} placeholder="Conta" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Input name="status" defaultValue={searchParams.status} placeholder="Status" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">
            Filtrar
          </Button>
        </form>
      </GlobalAdminPanel>

      <GlobalAdminPanel title="Eventos recebidos" description="Os mais recentes aparecem primeiro.">
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhum webhook encontrado"
              description="Tente outro identificador ou revise a conta para localizar o evento."
            />
          ) : (
            data.items.map((item) => (
              <Link
                key={`${item.source}-${item.id}`}
                href={item.href ?? '/developer/webhooks'}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{item.evento ?? 'Evento sem nome'}</p>
                      <GlobalAdminSeverityBadge
                        severity={
                          item.status === 'REJEITADO'
                            ? 'critical'
                            : item.status === 'ERRO' || item.status === 'EXAURIDO'
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {item.status}
                      </GlobalAdminSeverityBadge>
                      <GlobalAdminSeverityBadge severity="info">
                        {item.source === 'REJECTION' ? 'rejeição' : 'webhook'}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.contaNome ?? 'Conta não identificada'}
                      {item.eventId ? ` • ${item.eventId}` : ''}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {item.errorMessage ?? 'Sem mensagem adicional.'}
                    </p>
                  </div>
                  <div className="text-sm text-slate-500 xl:text-right">
                    <p>{item.asaasPaymentId ? `Payment ${item.asaasPaymentId}` : 'Sem paymentId'}</p>
                    <p>{item.tentativas > 0 ? `${item.tentativas} tentativa(s)` : 'Sem tentativas registradas'}</p>
                    <p>{new Date(item.receivedAt).toLocaleString('pt-BR')}</p>
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
