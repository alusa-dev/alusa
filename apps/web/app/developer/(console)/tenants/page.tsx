import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { getGlobalAdminDashboard } from '@/features/global-admin/dashboard/queries';
import { GlobalAdminLiveRefresh } from '@/features/global-admin/shared/GlobalAdminLiveRefresh';
import { GlobalAdminEmptyState, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperTenantsPage() {
  const data = await getGlobalAdminDashboard();

  return (
    <div className="space-y-6">
      <GlobalAdminLiveRefresh intervalMs={60_000} />

      <GlobalAdminPageIntro
        eyebrow="Contas"
        title="Contas que pedem atenção"
        description="Lista das contas mais sensíveis no momento, priorizadas pelos sinais operacionais encontrados."
      />

      <GlobalAdminPanel title="Contas monitoradas" description="Abra a conta para investigar webhooks, cobrança, fila e histórico.">
        <div className="space-y-3">
          {data.incidents.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhuma conta com alerta"
              description="Se uma conta ficar com webhook ruim, fila travada ou pagamento divergente, ela aparecerá aqui."
            />
          ) : (
            data.incidents.map((incident) => (
              <Link
                key={incident.tenantId}
                href={incident.href}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{incident.tenantName}</p>
                      <GlobalAdminSeverityBadge severity={incident.severity}>
                        {incident.severity === 'critical' ? 'atenção alta' : incident.severity === 'warning' ? 'acompanhar' : 'informativo'}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{incident.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    {incident.categories.map((category) => (
                      <Badge key={category} variant="neutral" className="capitalize">
                        {category}
                      </Badge>
                    ))}
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
