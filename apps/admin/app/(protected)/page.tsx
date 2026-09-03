import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { getSupportOverview, searchSupport } from '@/features/support/queries/support-dashboard';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  EmptyState,
  RowLink,
  StatusBadge,
  SupportMetric,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

export default async function DeveloperSupportHome({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const session = await requireAdminSessionForPage('');
  const query = searchParams?.q ?? '';
  const [overview, results] = await Promise.all([getSupportOverview(), searchSupport(query)]);
  const receitaMensal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(overview.receitaMensalCents / 100);

  return (
    <SupportShell session={session}>
      <div className="admin-overview">
        <SupportPageHeader
          title="Central do Administrador"
          description="Consulte e acompanhe as principais informações da plataforma em um só lugar."
        />

        <SupportPanel className="overview-search-panel">
          <form className="overview-search-form" action="">
            <div className="overview-search-field">
            <Input
              name="q"
              defaultValue={query}
              className="overview-search-input"
              placeholder="Nome, e-mail, escola, ID ou cobrança"
            />
            </div>
            <Button className="overview-search-button" type="submit">Buscar</Button>
          </form>
        </SupportPanel>

        <div className="overview-metrics">
          <SupportMetric label="Contas ativas" value={overview.contasAtivas} />
          <SupportMetric label="Contas inativas" value={overview.contasInativas} />
          <SupportMetric label="Assinaturas em atraso" value={overview.assinaturasEmAtraso} tone="warning" />
          <SupportMetric label="Cancelamentos no mês" value={overview.cancelamentosNoMes} tone="danger" />
          <SupportMetric label="Receita mensal" value={receitaMensal} tone="success" />
        </div>

        <div className="overview-results">
          <SupportPanel
            title={query ? `Resultados para "${query}"` : 'Como começar'}
            description={
              query
                ? 'Resultados agrupados por entidades operacionais.'
                : 'Digite pelo menos dois caracteres para iniciar um diagnóstico.'
            }
          >
            {query && results.length > 0 ? (
              <div className="space-y-3">
                {results.map((item, index) => (
                  <RowLink
                    key={`${item.type}-${item.contaId}-${index}`}
                    href={item.href}
                    title={`${item.type}: ${item.title}`}
                    description={item.description}
                    meta={
                      <>
                        <StatusBadge value={item.meta} />
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                          contaId {item.contaId}
                        </span>
                      </>
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={query ? 'Nenhum resultado encontrado' : 'Busca orientada a suporte'}
                description="A busca preserva o contexto multi-tenant e sempre direciona para uma conta antes de expor detalhes operacionais."
              />
            )}
          </SupportPanel>
        </div>
      </div>
    </SupportShell>
  );
}
