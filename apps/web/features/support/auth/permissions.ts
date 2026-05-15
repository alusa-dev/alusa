import type { GlobalAdminSession } from '@/features/global-admin/auth/session.server';

export type SupportRole = GlobalAdminSession['role'];

const roleRank: Record<SupportRole, number> = {
  SUPPORT_VIEWER: 10,
  SUPPORT_AGENT: 20,
  SUPPORT_FINANCE: 30,
  SUPPORT_DEVELOPER: 30,
  SUPPORT_ADMIN: 40,
  BREAK_GLASS: 50,
};

export function canManageSupportUsers(role: SupportRole) {
  return role === 'SUPPORT_ADMIN' || role === 'BREAK_GLASS';
}

export function canViewTechnicalLogs(role: SupportRole) {
  return ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'].includes(role);
}

export function canRunFinanceActions(role: SupportRole) {
  return ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'].includes(role);
}

export function canWriteSupportNotes(role: SupportRole) {
  return roleRank[role] >= roleRank.SUPPORT_AGENT;
}

export function assertSupportRole(session: GlobalAdminSession, allowed: SupportRole[]) {
  if (!allowed.includes(session.role)) {
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
