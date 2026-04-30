import { GlobalAdminActionCenter } from '@/features/global-admin/shared/GlobalAdminActionCenter';
import { GlobalAdminPageIntro } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default function DeveloperActionsPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; eventId?: string; asaasPaymentId?: string };
}) {
  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Ações rápidas"
        title="Ferramentas de correção"
        description="Use estas ações quando precisar alinhar webhook, fila, pagamento ou sincronização. Tudo fica auditado para consulta posterior."
      />
      <GlobalAdminActionCenter
        initialTenantId={searchParams.tenantId}
        initialEventId={searchParams.eventId}
        initialPaymentId={searchParams.asaasPaymentId}
      />
    </div>
  );
}
