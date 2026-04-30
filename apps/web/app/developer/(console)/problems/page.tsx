import Link from 'next/link';

import { listGlobalAdminSupportCases } from '@/features/global-admin/support/queries';
import { GlobalAdminEmptyState, GlobalAdminMetricCard, GlobalAdminPageIntro, GlobalAdminPanel, GlobalAdminSeverityBadge } from '@/features/global-admin/shared/GlobalAdminUI';

export const dynamic = 'force-dynamic';

export default async function DeveloperProblemsPage() {
  const data = await listGlobalAdminSupportCases({ limit: 80 });

  return (
    <div className="space-y-6">
      <GlobalAdminPageIntro
        eyebrow="Atendimento"
        title="Problemas do dia a dia"
        description="Aqui ficam os casos mais comuns que pedem ação rápida: acesso pendente, webhook com falha, cobrança travada e pagamento sem atualização."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlobalAdminMetricCard label="Total aberto" value={data.summary.total} description="Casos encontrados na janela atual." />
        <GlobalAdminMetricCard label="Críticos" value={data.summary.critical} description="Casos que podem travar atendimento ou financeiro." tone={data.summary.critical > 0 ? 'critical' : 'default'} />
        <GlobalAdminMetricCard label="Acompanhar" value={data.summary.warning} description="Itens que pedem correção antes de virar problema maior." tone={data.summary.warning > 0 ? 'warning' : 'default'} />
        <GlobalAdminMetricCard label="Informativos" value={data.summary.informational} description="Itens úteis para contexto e operação." />
      </section>

      <GlobalAdminPanel title="Fila prática de atendimento" description="Comece pelos itens críticos e depois avance para os demais.">
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <GlobalAdminEmptyState
              title="Nenhum problema listado"
              description="Quando surgir um caso operacional importante, ele aparecerá aqui com uma ação sugerida."
            />
          ) : (
            data.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">{item.title}</p>
                      <GlobalAdminSeverityBadge severity={item.severity}>
                        {item.statusLabel}
                      </GlobalAdminSeverityBadge>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">{item.summary}</p>
                    <p className="text-xs text-slate-500">
                      {item.contaNome ? `${item.contaNome} • ` : ''}
                      {item.personName ? `${item.personName} • ` : ''}
                      {new Date(item.detectedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="text-sm font-medium text-brand-accent">{item.suggestedAction}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </GlobalAdminPanel>
    </div>
  );
}
