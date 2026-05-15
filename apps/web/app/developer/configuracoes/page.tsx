import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { canManageSupportUsers } from '@/features/support/auth/permissions';
import { listSupportUsers } from '@/features/support/auth/support-users.server';
import { SupportShell } from '@/features/support/shared/SupportShell';
import { SupportUserManagement } from '@/features/support/shared/SupportUserManagement';
import { SupportPageHeader, SupportPanel } from '@/features/support/shared/SupportUI';

const roles = [
  ['SUPPORT_VIEWER', 'Leitura básica de contas, usuários, alunos, matrículas e cobranças.'],
  ['SUPPORT_AGENT', 'Notas internas, convites, notificações e triagem de atendimento.'],
  ['SUPPORT_FINANCE', 'Reconciliação individual, status Asaas e divergências financeiras.'],
  ['SUPPORT_DEVELOPER', 'Logs técnicos, payloads mascarados e correlationId/requestId.'],
  ['SUPPORT_ADMIN', 'Permissões internas, auditoria completa e políticas sensíveis.'],
  ['BREAK_GLASS', 'Acesso emergencial com TTL, motivo obrigatório e auditoria destacada.'],
];

export default async function SupportSettingsPage() {
  const session = await requireGlobalAdminSessionForPage('/developer/configuracoes');
  const canManageUsers = canManageSupportUsers(session.role);
  const users = canManageUsers ? await listSupportUsers() : [];

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Configurações internas"
        title="Permissões e políticas de suporte"
        description="Mapa de papéis recomendado para evoluir além do acesso único atual."
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
              Somente SUPPORT_ADMIN ou BREAK_GLASS pode gerenciar usuários internos.
            </p>
          )}
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
