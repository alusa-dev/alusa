import type { AdminSession } from '@/lib/admin-session';
import { hasAdminPermission } from '@alusa/admin-auth/roles';
import type { AdminPermission } from '@alusa/admin-auth/roles';

export type SupportRole = AdminSession['role'];

const roleRank: Record<SupportRole, number> = {
  SUPPORT_VIEWER: 10,
  SUPPORT_AGENT: 20,
  SUPPORT_FINANCE: 30,
  SUPPORT_DEVELOPER: 30,
  SUPPORT_ADMIN: 40,
  BREAK_GLASS: 50,
};

const ELEVATED_PERMISSIONS_BY_ROLE: Partial<Record<SupportRole, readonly AdminPermission[]>> = {
  SUPPORT_VIEWER: ['accounts.read', 'users.read', 'students.read', 'finance.read', 'webhooks.read'],
  SUPPORT_AGENT: ['support.cases.write', 'support.notes.write'],
  SUPPORT_FINANCE: ['finance.read', 'finance.reconcile', 'webhooks.read'],
  SUPPORT_DEVELOPER: ['technical.logs.read', 'webhooks.replay'],
  SUPPORT_ADMIN: ['admin.users.manage', 'admin.settings.manage'],
};

const ELEVATED_PERMISSIONS_BY_SCOPE: Record<string, readonly AdminPermission[]> = {
  'admin-support-users': ['admin.users.manage', 'admin.settings.manage'],
  'admin-audit': ['technical.logs.read'],
  'admin-finance': ['finance.read'],
  'admin-webhooks': ['webhooks.read', 'technical.logs.read'],
  'admin-read-model-backfill': ['technical.logs.read'],
  'admin-read-model-health': ['finance.read', 'technical.logs.read'],
  'admin-action-case': ['support.cases.write'],
  'admin-action-note': ['support.notes.write'],
  'admin-action-resend-invite': ['support.notes.write'],
  'admin-action-reconcile-charge': ['finance.reconcile'],
  'admin-action-divergence': ['finance.reconcile'],
  'admin-action-check-asaas-status': ['finance.read', 'technical.logs.read'],
  'admin-action-refresh-charge-links': ['finance.read'],
  'admin-action-replay-webhook': ['webhooks.replay'],
  'admin-action-asaas-support-diagnose': ['finance.read'],
  'admin-action-asaas-support-repair': ['finance.reconcile'],
  'admin-action-asaas-save-manual-api-key': ['finance.reconcile'],
};

function hasElevatedPermission(session: AdminSession, permission: AdminPermission) {
  return hasAdminPermission(session.adminRole, permission, session.elevatedPermissions)
    && session.elevatedPermissions.includes(permission);
}

function hasAnyElevatedPermission(session: AdminSession, permissions: readonly AdminPermission[]) {
  return permissions.some((permission) => hasElevatedPermission(session, permission));
}

export function hasSupportRoleAccess(session: AdminSession, allowed: SupportRole[], scope = 'admin-api') {
  if (allowed.includes(session.role)) return true;
  const scopedPermissions = ELEVATED_PERMISSIONS_BY_SCOPE[scope];
  if (scopedPermissions) return hasAnyElevatedPermission(session, scopedPermissions);
  return allowed.some((role) => hasAnyElevatedPermission(session, ELEVATED_PERMISSIONS_BY_ROLE[role] ?? []));
}

export function canManageSupportUsers(session: AdminSession) {
  return session.role === 'SUPPORT_ADMIN'
    || hasAnyElevatedPermission(session, ['admin.users.manage', 'admin.settings.manage']);
}

export function canViewTechnicalLogs(session: AdminSession) {
  return ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN'].includes(session.role)
    || hasElevatedPermission(session, 'technical.logs.read');
}

export function canRunFinanceActions(session: AdminSession) {
  return ['SUPPORT_FINANCE', 'SUPPORT_ADMIN'].includes(session.role)
    || hasElevatedPermission(session, 'finance.reconcile');
}

export function canWriteSupportNotes(session: AdminSession) {
  return roleRank[session.role] >= roleRank.SUPPORT_AGENT
    || hasAnyElevatedPermission(session, ['support.cases.write', 'support.notes.write']);
}

export function canReplayWebhooks(session: AdminSession) {
  return ['SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN'].includes(session.role)
    || hasElevatedPermission(session, 'webhooks.replay');
}

export function canCheckAsaas(session: AdminSession) {
  return ['SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN'].includes(session.role)
    || hasAnyElevatedPermission(session, ['finance.read', 'technical.logs.read']);
}

export function assertSupportRole(session: AdminSession, allowed: SupportRole[]) {
  if (!hasSupportRoleAccess(session, allowed)) {
    return {
      ok: false as const,
      response: Response.json(
        { success: false, error: 'Permissão insuficiente' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const };
}
