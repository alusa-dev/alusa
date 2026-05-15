import Link from 'next/link';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { listSupportCases } from '@/features/support/queries/support-entities';
import { formatDateTime } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { StatusBadge, SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

export default async function SupportCasesPage() {
  const session = await requireGlobalAdminSessionForPage('/developer/casos');
  const cases = await listSupportCases();

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Casos"
        title="Casos de suporte"
        description="Fila operacional para acompanhar atendimentos, entidades afetadas e responsáveis internos."
      />

      <SupportPanel title="Casos recentes" description={`${cases.length} casos recentes`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="py-3 pr-4">Conta</th>
                <th className="py-3 pr-4">Caso</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Prioridade</th>
                <th className="py-3 pr-4">Entidade</th>
                <th className="py-3 pr-4">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 pr-4">
                    <Link
                      className="font-medium text-slate-950 hover:underline"
                      href={`/developer/contas/${item.contaId}`}
                    >
                      {item.conta.nome}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-slate-950">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.openedByName ?? 'Suporte'}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={item.status} />
                  </td>
                  <td className="py-3 pr-4">{item.priority}</td>
                  <td className="py-3 pr-4">
                    {item.entityType ? `${item.entityType} · ${item.entityId ?? 'sem id'}` : 'Conta'}
                  </td>
                  <td className="py-3 pr-4">{formatDateTime(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SupportPanel>
    </SupportShell>
  );
}
