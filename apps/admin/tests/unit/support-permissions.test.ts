import { describe, expect, it } from 'vitest';
import type { AdminSession } from '@/lib/admin-session';
import {
  canManageSupportUsers,
  canReplayWebhooks,
  canRunFinanceActions,
  hasSupportRoleAccess,
} from '@/features/support/auth/permissions';

function session(input: Partial<AdminSession> = {}): AdminSession {
  return {
    username: 'operator',
    issuedAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    supportUserId: 'admin-user-id',
    role: 'SUPPORT_VIEWER',
    adminRole: 'READ_ONLY',
    elevatedPermissions: [],
    ...input,
  };
}

describe('admin temporary elevation permissions', () => {
  it('does not turn a read-only operator into break-glass access', () => {
    const readOnly = session();

    expect(canManageSupportUsers(readOnly)).toBe(false);
    expect(canRunFinanceActions(readOnly)).toBe(false);
    expect(canReplayWebhooks(readOnly)).toBe(false);
    expect(hasSupportRoleAccess(readOnly, ['BREAK_GLASS'], 'admin-support-users')).toBe(false);
  });

  it('grants only the explicitly elevated finance capability', () => {
    const elevated = session({ elevatedPermissions: ['finance.reconcile'] });

    expect(canRunFinanceActions(elevated)).toBe(true);
    expect(canManageSupportUsers(elevated)).toBe(false);
    expect(canReplayWebhooks(elevated)).toBe(false);
    expect(hasSupportRoleAccess(elevated, ['SUPPORT_FINANCE', 'BREAK_GLASS'], 'admin-action-reconcile-charge')).toBe(true);
    expect(hasSupportRoleAccess(elevated, ['SUPPORT_ADMIN', 'BREAK_GLASS'], 'admin-support-users')).toBe(false);
  });

  it('allows an explicit webhook elevation without granting finance actions', () => {
    const elevated = session({ elevatedPermissions: ['webhooks.replay'] });

    expect(canReplayWebhooks(elevated)).toBe(true);
    expect(canRunFinanceActions(elevated)).toBe(false);
    expect(hasSupportRoleAccess(elevated, ['SUPPORT_DEVELOPER', 'BREAK_GLASS'], 'admin-action-replay-webhook')).toBe(true);
  });
});
