import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { listSupportAccounts } from '@/features/support/queries/support-dashboard';
import { formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  RowLink,
  StatusBadge,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

export default async function SupportAccountsPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const session = await requireGlobalAdminSessionForPage('/developer/contas');
  const query = searchParams?.q ?? '';
  const accounts = await listSupportAccounts(query);

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Contas"
        title="Contas monitoradas"
        description="Lista operacional de escolas com contadores úteis para triagem inicial."
      />

      <SupportPanel>
        <form className="flex flex-col gap-3 sm:flex-row" action="/developer/contas">
          <Input name="q" defaultValue={query} placeholder="Nome da escola, contaId ou CNPJ" />
          <Button type="submit">Filtrar</Button>
        </form>
      </SupportPanel>

      <div className="mt-6">
        <SupportPanel title="Resultados" description={`${accounts.length} contas exibidas`}>
          <div className="space-y-3">
            {accounts.map((account) => (
              <RowLink
                key={account.id}
                href={`/developer/contas/${account.id}`}
                title={account.nome}
                description={`Atualizada em ${formatDateTime(account.updatedAt)}`}
                meta={
                  <>
                    <StatusBadge value={account.status} />
                    <StatusBadge value={account.financeStatus} />
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {account._count.usuariosConta} usuários
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {account._count.chargeReadModels} cobranças
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {account._count.webhooks} webhooks
                    </span>
                  </>
                }
              />
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
