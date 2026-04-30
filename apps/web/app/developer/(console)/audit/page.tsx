import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listGlobalAdminAudit } from '@/features/global-admin/audit/queries';
import { GlobalAdminEmptyState, GlobalAdminLinkTabs, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperAuditPage({
  searchParams,
}: {
  searchParams: {
    tenantId?: string;
    action?: string;
    actorIdentifier?: string;
    search?: string;
    status?: 'SUCCESS' | 'ERROR';
  };
}) {
  const data = await listGlobalAdminAudit(searchParams);
  const status = searchParams.status ?? '';

  function buildStatusHref(nextStatus: '' | 'SUCCESS' | 'ERROR') {
    const params = new URLSearchParams();
    if (searchParams.tenantId) params.set('tenantId', searchParams.tenantId);
    if (searchParams.action) params.set('action', searchParams.action);
    if (searchParams.actorIdentifier) params.set('actorIdentifier', searchParams.actorIdentifier);
    if (searchParams.search) params.set('search', searchParams.search);
    if (nextStatus) params.set('status', nextStatus);
    const suffix = params.toString();
    return suffix ? `/developer/audit?${suffix}` : '/developer/audit';
  }

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Rastreabilidade"
        title="Histórico de ações"
        description="Tudo o que foi executado no admin global fica registrado aqui com motivo, conta afetada e resultado."
      />

      <GlobalAdminPanel title="Filtros" description="Busque por conta, ação, usuário do suporte ou texto livre.">
          <div className="space-y-3">
          <GlobalAdminLinkTabs
            items={[
              { href: buildStatusHref(''), label: 'Qualquer resultado', active: status === '' },
              { href: buildStatusHref('SUCCESS'), label: 'Concluídas', active: status === 'SUCCESS' },
              { href: buildStatusHref('ERROR'), label: 'Com falha', active: status === 'ERROR' },
            ]}
          />
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" method="GET">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <Input name="tenantId" defaultValue={searchParams.tenantId} placeholder="Conta" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
            <Input name="action" defaultValue={searchParams.action} placeholder="Ação" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
            <Input
              name="actorIdentifier"
              defaultValue={searchParams.actorIdentifier}
              placeholder="Ator"
              className="h-10 rounded-lg border-slate-200 bg-white shadow-sm"
            />
            <Input name="search" defaultValue={searchParams.search} placeholder="Texto livre" className="h-10 rounded-lg border-slate-200 bg-white shadow-sm" />
            <div className="md:col-span-2 xl:col-span-4">
              <Button type="submit" className="h-10 rounded-lg bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90">Filtrar</Button>
            </div>
          </form>
          </div>
      </GlobalAdminPanel>

      <GlobalAdminPanel title="Registros" description="Os registros mais recentes aparecem primeiro.">
          <div className="space-y-3">
            {data.entries.length === 0 ? (
              <GlobalAdminEmptyState
                title="Nenhum registro encontrado"
                description="Ajuste os filtros ou aguarde novas ações administrativas para preencher esta lista."
              />
            ) : (
              data.entries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{entry.action}</p>
                      <p className="text-sm text-slate-600">
                        {entry.tenantName} • {entry.actorIdentifier}
                      </p>
                    </div>
                    <GlobalAdminSeverityBadge severity={entry.status === 'SUCCESS' ? 'success' : 'warning'}>
                      {entry.status === 'SUCCESS' ? 'concluída' : 'com falha'}
                    </GlobalAdminSeverityBadge>
                  </div>
                  <p className="mt-3 text-sm text-slate-700">{entry.summary ?? 'Sem resumo adicional.'}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {entry.reason ? `${entry.reason} • ` : ''}
                    {entry.targetType ? `${entry.targetType}:${entry.targetId ?? '-'} • ` : ''}
                    {new Date(entry.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))
            )}
          </div>
      </GlobalAdminPanel>
    </div>
  );
}
