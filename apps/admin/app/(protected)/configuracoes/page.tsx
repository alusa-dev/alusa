import { requireAdminSessionForPage } from '@/lib/admin-session';
import { canManageSupportUsers } from '@/features/support/auth/permissions';
import { listSupportUsers } from '@/features/support/auth/support-users.server';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { SupportUserManagement } from '@/features/support/shared/SupportUserManagement';
import { SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

const roles = [
  ['READ_ONLY', 'Leitura de contas, usuários, alunos, matrículas e cobranças.'],
  ['SUPPORT', 'Notas internas, convites e triagem de atendimento.'],
  ['FINANCE_OPS', 'Reconciliação individual, status Asaas e divergências financeiras.'],
  ['ENGINEERING', 'Logs técnicos, payloads mascarados e reprocessamento de webhooks.'],
  ['OWNER', 'Gestão de identidades, auditoria completa e políticas sensíveis.'],
];

export default async function SupportSettingsPage() {
  const session = await requireAdminSessionForPage('/configuracoes');
  const canManageUsers = canManageSupportUsers(session);
  const users = canManageUsers ? await listSupportUsers() : [];

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Configurações internas"
        title="Permissões e políticas de suporte"
        description="Identidades administrativas persistidas, com menor privilégio e auditoria."
      />
      <SupportPanel
        title="RBAC"
        description="Papéis usados pelas APIs da central e pelas ações sensíveis."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map(([role, description]) => (
            <div key={role} className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-950">{role}</p>
              <p className="mt-2 text-sm text-slate-500">{description}</p>
            </div>
          ))}
        </div>
      </SupportPanel>

      <div className="mt-6">
        <SupportPanel
          title="Usuários internos"
          description="Criação, ativação, desativação e ajuste de papéis com auditoria automática."
        >
          {canManageUsers ? (
            <SupportUserManagement users={users} />
          ) : (
            <p className="text-sm text-slate-600">
              Somente OWNER pode gerenciar identidades administrativas.
            </p>
          )}
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
