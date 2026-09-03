import { Icon } from '@/components/icons/Icon';
import Link from 'next/link';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { listSupportAccountsPage } from '@/features/support/queries/support-dashboard';
import { AccountsSearch } from '@/features/support/components/AccountsSearch';
import { AccountsPagination } from '@/features/support/components/AccountsPagination';
import { formatDateTime, formatSupportStatus } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  StatusBadge,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

export default async function SupportAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const session = await requireAdminSessionForPage('/contas');
  const params = await searchParams;
  const query = params?.q ?? '';
  const requestedPage = Number.parseInt(params?.page ?? '1', 10);
  const accountsPage = await listSupportAccountsPage(query, Number.isFinite(requestedPage) ? requestedPage : 1);
  const { accounts } = accountsPage;
  type AccountRow = (typeof accounts)[number];

  const columns: DataTableColumn<AccountRow>[] = [
    {
      id: 'conta',
      header: 'Conta',
      width: 'accounts-table-column-account',
      render: (account) => (
        <div className="accounts-table-account">
          <strong>{account.nome}</strong>
          <span>{account.id}</span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Situação',
      width: 'accounts-table-column-status',
      render: (account) => (
        <StatusBadge
          value={account.status}
          label={formatSupportStatus(account.status)}
          tone={account.status === 'ATIVO' ? 'success' : 'warning'}
        />
      ),
    },
    {
      id: 'financeiro',
      header: 'Financeiro',
      width: 'accounts-table-column-finance',
      render: (account) => <StatusBadge value={account.financeStatus} label={formatSupportStatus(account.financeStatus)} />,
    },
    {
      id: 'usuarios',
      header: 'Usuários',
      align: 'right',
      width: 'accounts-table-column-number',
      render: (account) => account._count.usuariosConta,
    },
    {
      id: 'cobrancas',
      header: 'Cobranças',
      align: 'right',
      width: 'accounts-table-column-number',
      render: (account) => account._count.chargeReadModels,
    },
    {
      id: 'webhooks',
      header: 'Webhooks',
      align: 'right',
      width: 'accounts-table-column-number',
      render: (account) => account._count.webhooks,
    },
    {
      id: 'atualizada',
      header: 'Atualizada',
      width: 'accounts-table-column-updated',
      render: (account) => formatDateTime(account.updatedAt),
    },
    {
      id: 'acoes',
      header: 'Ações',
      align: 'right',
      width: 'accounts-table-column-actions',
      render: (account) => (
        <Link className="accounts-table-action" href={`/contas/${account.id}`} aria-label={`Abrir conta ${account.nome}`}>
          <Icon name="ChevronRight" size={18} aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <SupportShell session={session}>
      <div className="admin-page accounts-page">
        <SupportPageHeader
          title="Contas monitoradas"
          description="Acompanhe as escolas e organizações cadastradas na Alusa."
        />

        <SupportPanel className="accounts-search-panel">
          <AccountsSearch initialQuery={query} />
        </SupportPanel>

        <div className="accounts-results">
          <SupportPanel title="Resultados" description={`${accountsPage.total} contas exibidas`} bodyClassName="accounts-results-panel-body">
            <DataTable
              data={accounts}
              columns={columns}
              rowKey={(account) => account.id}
              ariaLabel="Contas monitoradas"
              tableClassName="accounts-table"
              emptyMessage="Nenhuma conta encontrada."
            />
            <AccountsPagination query={query} page={accountsPage.page} totalPages={accountsPage.totalPages} />
          </SupportPanel>
        </div>
      </div>
    </SupportShell>
  );
}
