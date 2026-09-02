import { describe, expect, it } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  adminRoleFromSupportRole,
  hasAdminPermission,
  supportRoleFromAdminRole,
} from '@alusa/admin-auth/roles';

describe('admin identity roles', () => {
  it('mapeia papéis legados sem elevar privilégios por omissão', () => {
    expect(adminRoleFromSupportRole('SUPPORT_VIEWER')).toBe('READ_ONLY');
    expect(adminRoleFromSupportRole('SUPPORT_AGENT')).toBe('SUPPORT');
    expect(adminRoleFromSupportRole('SUPPORT_FINANCE')).toBe('FINANCE_OPS');
    expect(adminRoleFromSupportRole('SUPPORT_DEVELOPER')).toBe('ENGINEERING');
    expect(adminRoleFromSupportRole('SUPPORT_ADMIN')).toBe('OWNER');
    expect(adminRoleFromSupportRole('UNKNOWN')).toBe('READ_ONLY');
  });

  it('preserva a conversão reversível dos papéis canônicos', () => {
    expect(supportRoleFromAdminRole('OWNER')).toBe('SUPPORT_ADMIN');
    expect(supportRoleFromAdminRole('ENGINEERING')).toBe('SUPPORT_DEVELOPER');
    expect(supportRoleFromAdminRole('READ_ONLY')).toBe('SUPPORT_VIEWER');
  });

  it('permite elevação somente por permissão explícita', () => {
    expect(hasAdminPermission('READ_ONLY', 'webhooks.replay')).toBe(false);
    expect(hasAdminPermission('READ_ONLY', 'webhooks.replay', ['webhooks.replay'])).toBe(true);
    expect(ADMIN_PERMISSIONS).toContain('admin.users.manage');
  });
});
