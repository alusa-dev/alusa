export const ADMIN_ROLES = ['OWNER', 'SUPPORT', 'FINANCE_OPS', 'ENGINEERING', 'READ_ONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'accounts.read', 'users.read', 'students.read', 'finance.read', 'finance.reconcile',
  'webhooks.read', 'webhooks.replay', 'support.cases.write', 'support.notes.write',
  'admin.users.manage', 'admin.settings.manage', 'technical.logs.read',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  OWNER: ADMIN_PERMISSIONS,
  SUPPORT: ['accounts.read', 'users.read', 'students.read', 'finance.read', 'webhooks.read', 'support.cases.write', 'support.notes.write'],
  FINANCE_OPS: ['accounts.read', 'finance.read', 'finance.reconcile', 'webhooks.read', 'support.cases.write', 'support.notes.write'],
  ENGINEERING: ['accounts.read', 'users.read', 'students.read', 'finance.read', 'webhooks.read', 'webhooks.replay', 'support.cases.write', 'support.notes.write', 'technical.logs.read'],
  READ_ONLY: ['accounts.read', 'users.read', 'students.read', 'finance.read', 'webhooks.read'],
};

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasAdminPermission(role: AdminRole, permission: AdminPermission, elevatedPermissions: readonly string[] = []) {
  return ROLE_PERMISSIONS[role].includes(permission) || elevatedPermissions.includes(permission);
}

export function adminRoleFromSupportRole(role: string): AdminRole {
  switch (role) {
    case 'SUPPORT_ADMIN': return 'OWNER';
    case 'SUPPORT_AGENT': return 'SUPPORT';
    case 'SUPPORT_FINANCE': return 'FINANCE_OPS';
    case 'SUPPORT_DEVELOPER': return 'ENGINEERING';
    case 'BREAK_GLASS':
    case 'SUPPORT_VIEWER':
    default: return 'READ_ONLY';
  }
}

export function supportRoleFromAdminRole(role: AdminRole): SupportRole {
  switch (role) {
    case 'OWNER': return 'SUPPORT_ADMIN';
    case 'SUPPORT': return 'SUPPORT_AGENT';
    case 'FINANCE_OPS': return 'SUPPORT_FINANCE';
    case 'ENGINEERING': return 'SUPPORT_DEVELOPER';
    case 'READ_ONLY': return 'SUPPORT_VIEWER';
  }
}
import type { SupportRole } from '@prisma/client';
