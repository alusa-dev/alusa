import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
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
  const session = await requireGlobalAdminSessionForPage('/developer');
  const query = searchParams?.q ?? '';
  const [overview, results] = await Promise.all([getSupportOverview(), searchSupport(query)]);

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Central"
        title="Busca universal"
        description="Encontre contas, usuários, alunos, responsáveis, matrículas, cobranças e eventos de webhook sem acessar o banco diretamente."
      />

      <SupportPanel>
        <form className="flex flex-col gap-3 sm:flex-row" action="/developer">
          <div className="relative flex-1">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              name="q"
              defaultValue={query}
              className="pl-9"
              placeholder="Buscar por escola, contaId, e-mail, aluno, cobrança, Asaas ID ou webhook"
            />
          </div>
          <Button type="submit">Buscar</Button>
        </form>
      </SupportPanel>

      <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SupportMetric label="Contas ativas" value={overview.contasAtivas} />
        <SupportMetric label="Usuários ativos" value={overview.usuariosAtivos} />
        <SupportMetric label="Alunos ativos" value={overview.alunosAtivos} />
        <SupportMetric label="Matrículas ativas" value={overview.matriculasAtivas} />
        <SupportMetric label="Cobranças abertas" value={overview.cobrancasAbertas} tone="warning" />
        <SupportMetric label="Webhooks com erro" value={overview.webhooksComErro} tone="danger" />
      </div>

      <div className="mt-6">
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
    </SupportShell>
  );
}
