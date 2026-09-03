import { requireAdminSessionForPage } from '@/lib/admin-session';
import {
  getSupportWebhookFilterOptions,
  listSupportWebhooksPage,
  SUPPORT_WEBHOOK_PAGE_SIZE,
  type SupportWebhookFilters,
} from '@/features/support/queries/support-account';
import { SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { WebhooksLogSplitView } from '@/features/support/components/WebhooksLogSplitView';
import { WebhooksRefreshButton } from '@/features/support/components/WebhooksRefreshButton';

function firstParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

export default async function SupportWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSessionForPage('/webhooks');
  const params = await searchParams;
  const filters: Required<SupportWebhookFilters> = {
    event: firstParam(params.event),
    status: firstParam(params.status),
    period: firstParam(params.period),
  };
  const pageValue = Number(firstParam(params.page));
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
  const [webhookPage, filterOptions] = await Promise.all([
    listSupportWebhooksPage({ page, pageSize: SUPPORT_WEBHOOK_PAGE_SIZE, filters }),
    getSupportWebhookFilterOptions(),
  ]);

  return (
    <SupportShell session={session}>
      <div className="admin-page webhooks-page">
        <SupportPageHeader
          title="Eventos Asaas recentes"
          description="Consulte eventos recebidos, falhas e tentativas de processamento."
        />

        <SupportPanel
          className="webhooks-log-panel"
          title="Logs"
          description={`${webhookPage.total} eventos encontrados`}
          actions={<WebhooksRefreshButton />}
          bodyClassName="webhooks-log-panel-body"
        >
          <WebhooksLogSplitView
            webhooks={webhookPage.items}
            pagination={webhookPage}
            filters={filters}
            eventTypes={filterOptions.events}
            statuses={filterOptions.statuses}
          />
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
