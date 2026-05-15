import Link from 'next/link';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { listSupportAudit } from '@/features/support/queries/support-account';
import { compactId, formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportAuditPage() {
  const session = await requireGlobalAdminSessionForPage('/developer/auditoria');
  const logs = await listSupportAudit();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Auditoria"
        title="Trilha operacional"
        description="Eventos auditáveis existentes por conta. Ações futuras do suporte devem exigir motivo e registrar before/after."
      />
      <SupportPanel title="Eventos recentes" description={`${logs.length} registros recentes`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Quando</th>
                <th className="py-3 pr-4">Conta</th>
                <th className="py-3 pr-4">Ação</th>
                <th className="py-3 pr-4">Ator</th>
                <th className="py-3 pr-4">Entidade</th>
                <th className="py-3 pr-4">Correlação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="py-3 pr-4">{formatDateTime(log.createdAt)}</td>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-slate-950 hover:underline"
                      href={`/developer/contas/${log.contaId}`}
                    >
                      {log.conta.nome}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{log.action}</td>
                  <td className="py-3 pr-4">
                    {log.actorType} · {compactId(log.actorId)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={log.entityType} />
                  </td>
                  <td className="py-3 pr-4">{compactId(log.correlationId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SupportPanel>
    </SupportShell>
  );
}
