import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listGlobalAdminRequestLogs } from '@/features/global-admin/logs/queries';
import { GlobalAdminEmptyState, GlobalAdminLinkTabs, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperRequestsPage({
  searchParams,
}: {
  searchParams: { q?: string; contaId?: string; status?: 'SUCCESS' | 'ERROR' | 'ALL' };
}) {
  const data = await listGlobalAdminRequestLogs({
    q: searchParams.q,
    contaId: searchParams.contaId,
    status: searchParams.status,
    limit: 100,
  });
  const status = searchParams.status ?? 'ALL';

  function buildStatusHref(nextStatus: 'ALL' | 'SUCCESS' | 'ERROR') {
    const params = new URLSearchParams();
    if (searchParams.q) params.set('q', searchParams.q);
    if (searchParams.contaId) params.set('contaId', searchParams.contaId);
    if (nextStatus !== 'ALL') params.set('status', nextStatus);
    const suffix = params.toString();
    return suffix ? `/developer/requests?${suffix}` : '/developer/requests';
  }

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Integrações"
        title="Logs de requisições"
        description="Veja as chamadas mais importantes das integrações para entender falhas de criação, atualização e sincronização."
      />

      <GlobalAdminPanel title="Filtros" description="Busque por conta, tipo de operação, entidade ou identificador.">
        <div className="space-y-3">
          <GlobalAdminLinkTabs
            items={[
              { href: buildStatusHref('ALL'), label: 'Tudo', active: status === 'ALL' },
              { href: buildStatusHref('ERROR'), label: 'Somente erros', active: status === 'ERROR' },
              { href: buildStatusHref('SUCCESS'), label: 'Somente sucesso', active: status === 'SUCCESS' },
            ]}
          />
          <form className="grid gap-3 md:grid-cols-[2fr,1fr,auto]" method="GET">
            {status !== 'ALL' ? <input type="hidden" name="status" value={status} /> : null}
          <Input name="q" defaultValue={searchParams.q} placeholder="Buscar por operação, entidade, erro ou id" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Input name="contaId" defaultValue={searchParams.contaId} placeholder="Conta" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
          <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">
            Filtrar
          </Button>
          </form>
        </div>
      </GlobalAdminPanel>

      <GlobalAdminPanel title="Histórico" description="As entradas mais recentes aparecem primeiro.">
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhuma requisição encontrada"
              description="Tente um filtro mais amplo para localizar a integração desejada."
            />
          ) : (
            data.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{item.tipoOperacao}</p>
                      <GlobalAdminSeverityBadge severity={item.status === 'ERROR' ? 'critical' : 'success'}>
                        {item.status === 'ERROR' ? 'erro' : 'ok'}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.contaNome} • {item.entidade} • {item.entidadeId}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {item.errorMessage ?? 'Sem mensagem de erro registrada.'}
                    </p>
                  </div>
                  <div className="text-sm text-slate-500 xl:text-right">
                    <p>{item.httpStatus ? `HTTP ${item.httpStatus}` : 'Sem status HTTP'}</p>
                    <p>{item.duration != null ? `${item.duration} ms` : 'Sem duração'}</p>
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
