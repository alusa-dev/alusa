import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { getSupportAccount, getSupportTimeline } from '@/features/support/queries/support-account';
import { formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportTimelinePage({ params }: { params: { contaId: string } }) {
  const session = await requireGlobalAdminSessionForPage(
    `/developer/contas/${params.contaId}/timeline`,
  );
  const [account, timeline] = await Promise.all([
    getSupportAccount(params.contaId),
    getSupportTimeline(params.contaId),
  ]);
  if (!account) notFound();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Timeline"
        title={`Linha do tempo de ${account.conta.nome}`}
        description="Eventos operacionais combinados para diagnosticar o que aconteceu sem abrir logs crus."
      />
      <SupportPanel title="Eventos recentes">
        <div className="space-y-4">
          {timeline.map((item) => (
            <div
              key={item.id}
              className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-[180px_1fr]"
            >
              <div>
                <p className="text-sm font-medium text-slate-950">{formatDateTime(item.at)}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{item.type}</p>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                  <StatusBadge value={item.status} />
                </div>
                <p className="mt-1 text-sm text-slate-500">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </SupportPanel>
    </SupportShell>
  );
}
